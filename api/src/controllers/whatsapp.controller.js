const { redact } = require('../utils/redact');
const whatsappService = require('../services/whatsapp.service');
const BaseController = require('./base.controller');
const qrcode = require('qrcode');

const tenantScope = (req) =>
  req.tenantContext
    ? {
        branch_id: req.tenantContext.branchId,
        branch_name: req.tenantContext.branchName,
        license: req.tenantContext.licenseId,
      }
    : {};

const activeBranchId = (req) =>
  req.tenantContext?.branchId ||
  req.body?.branch_id ||
  req.query?.branch_id ||
  req.session?.selectedBranchId ||
  req.session?.branch_id ||
  req.user?.branch_id ||
  req.user?.branch?._id ||
  req.user?.default_branch_id ||
  req.user?.branch_access?.[0]?.branch_id;

const branchIdentity = (req, branchId) => ({
  _id: branchId,
  ...(req.tenantContext ? { license: req.tenantContext.licenseId } : {}),
});

const templateScope = (req) =>
  req.tenantContext ? tenantScope(req) : { branch_id: activeBranchId(req) };

class WhatsAppController extends BaseController {
  constructor() {
    super();
  }

  /*
   * Whether this branch's QR-linked WhatsApp rides the signed connector
   * (I5/I6) instead of the in-process client. When it does, the screen's
   * init/QR/status calls are answered from the state the connector mirrors
   * through /connector/whatsapp/state - same shapes, different engine.
   */
  async _connectorTransport(req, branchId) {
    try {
      const db = req.db;
      if (!db || !branchId) return false;
      const { ObjectId } = require('mongodb');
      const q = ObjectId.isValid(String(branchId))
        ? { branch_id: new ObjectId(String(branchId)) }
        : { branch_id: branchId };
      const row = await db.collection('messaging_settings').findOne(q);
      return !!(row && row.whatsapp_transport === 'connector');
    } catch (e) {
      return false;
    }
  }

  /**
   * Initialize WhatsApp client and generate QR code
   */
  async initializeConnection(req, res) {
    try {
      const { device_id } = req.body;
      const branchId = activeBranchId(req);

      if (!device_id) {
        return res.json({
          type: 'error',
          message: 'Device ID is required',
        });
      }

      if (!branchId) {
        return res.json({
          type: 'error',
          message: 'Branch ID not found. Please ensure you are logged in.',
        });
      }

      if (await this._connectorTransport(req, branchId)) {
        // Ask the connector, not Chromium: record the request where the
        // connector polls, and the QR arrives via its state mirror.
        const outbox = require('../services/whatsapp-outbox');
        await outbox.recordState(req.db, req.user && req.user.license, {
          branch_id: branchId,
          device_id,
          status: 'init_requested',
          qr: null,
        });
        try {
          const Branch = require('../models/branch.model');
          await Branch.updateOne(branchIdentity(req, branchId), {
            $set: { whatsapp_device_id: device_id },
          });
        } catch (error) {
          console.error('Error saving device_id:', error);
        }
        return res.json({
          type: 'success',
          message: 'Link requested - the connector will show a QR code shortly',
          data: { connected: false, device_id, qr_code: null, qr_status: 'init_requested' },
        });
      }

      const result = await whatsappService.initializeClient(device_id, branchId);

      // Save device_id to branch settings
      if (result.status) {
        try {
          const Branch = require('../models/branch.model');
          await Branch.updateOne(branchIdentity(req, branchId), {
            $set: { whatsapp_device_id: device_id },
          });
        } catch (error) {
          console.error('Error saving device_id:', error);
        }
      }

      return res.json({
        type: result.status ? 'success' : 'error',
        message: result.message,
        data: {
          connected: result.connected,
          device_id: device_id,
          qr_code: result.qrCode || null,
          qr_status: result.qrStatus || null,
        },
      });
    } catch (error) {
      console.error('Error in initializeConnection:', error);
      return res.json({
        type: 'error',
        message: error.message,
      });
    }
  }

  /**
   * Get QR code for scanning
   */
  async getQRCode(req, res) {
    try {
      const { device_id } = req.query;

      // Get branch_id with multiple fallbacks
      const branchId = activeBranchId(req);

      if (!device_id || !branchId) {
        return res.json({
          type: 'error',
          message: 'Device ID and Branch ID are required',
        });
      }

      if (await this._connectorTransport(req, branchId)) {
        const outbox = require('../services/whatsapp-outbox');
        const state = await outbox.getState(req.db, branchId);
        const raw = state && state.qr;
        return res.json({
          type: 'success',
          data: {
            qr_code: raw ? (raw.startsWith('data:') ? raw : await qrcode.toDataURL(raw)) : null,
            status: (state && state.status) || 'not_initialized',
            device_id,
          },
        });
      }

      const rawQrCode = whatsappService.getQRCode(device_id, branchId);
      const qrCode = rawQrCode
        ? rawQrCode.startsWith && rawQrCode.startsWith('data:')
          ? rawQrCode
          : await qrcode.toDataURL(rawQrCode)
        : null;
      const status = whatsappService.getConnectionStatus(device_id, branchId);

      return res.json({
        type: 'success',
        data: {
          qr_code: qrCode,
          status: status,
          device_id: device_id,
        },
      });
    } catch (error) {
      console.error('Error in getQRCode:', error);
      return res.json({
        type: 'error',
        message: error.message,
      });
    }
  }

  /**
   * Get connection status
   */
  async getConnectionStatus(req, res) {
    try {
      const { device_id } = req.query;

      // Debug session data
      console.log('WhatsApp status check - Session data:', {
        session: req.session,
        user: req.user,
        selectedBranchId: req.session?.selectedBranchId,
        branch_id: req.session?.branch_id,
        user_branch_id: req.user?.branch_id,
        user_branch: req.user?.branch?._id,
        default_branch_id: req.user?.default_branch_id,
        branch_access: req.user?.branch_access,
      });

      const resolvedBranchId = activeBranchId(req);

      console.log('Resolved branch ID:', resolvedBranchId);

      if (!device_id || !resolvedBranchId) {
        return res.json({
          type: 'error',
          message: 'Device ID and Branch ID are required',
        });
      }

      if (await this._connectorTransport(req, resolvedBranchId)) {
        const outbox = require('../services/whatsapp-outbox');
        const state = await outbox.getState(req.db, resolvedBranchId);
        const s = (state && state.status) || 'not_initialized';
        return res.json({
          type: 'success',
          data: { status: s, device_id, connected: s === 'connected' },
        });
      }

      const status = whatsappService.getConnectionStatus(device_id, resolvedBranchId);

      return res.json({
        type: 'success',
        data: {
          status: status,
          device_id: device_id,
          connected: status === 'connected',
        },
      });
    } catch (error) {
      console.error('Error in getConnectionStatus:', error);
      return res.json({
        type: 'error',
        message: error.message,
      });
    }
  }

  /**
   * Logout and disconnect WhatsApp
   */
  async logout(req, res) {
    try {
      const { device_id } = req.body;

      // Get branch_id with multiple fallbacks
      const branchId = activeBranchId(req);

      if (!device_id || !branchId) {
        return res.json({
          type: 'error',
          message: 'Device ID and Branch ID are required',
        });
      }

      const result = await whatsappService.logout(device_id, branchId);

      return res.json({
        type: result.status ? 'success' : 'error',
        message: result.message,
      });
    } catch (error) {
      console.error('Error in logout:', error);
      return res.json({
        type: 'error',
        message: error.message,
      });
    }
  }

  /**
   * Remove device and clear from database
   */
  async removeDevice(req, res) {
    try {
      const { device_id } = req.body;
      const branchId = activeBranchId(req);

      if (!device_id || !branchId) {
        return res.json({
          type: 'error',
          message: 'Device ID and Branch ID are required',
        });
      }

      // Try to clear the device_id from branch
      try {
        const Branch = require('../models/branch.model');
        await Branch.updateOne(branchIdentity(req, branchId), { $set: { whatsapp_device_id: '' } });
      } catch (error) {
        console.error('Error clearing device_id from branch:', error);
      }

      // Safe logout attempt to ensure session is cleared locally as well
      try {
        await whatsappService.logout(device_id, branchId);
      } catch (e) {
        console.log(
          'Safe logout during remove device failed (expected if already logged out):',
          e.message
        );
      }

      return res.json({
        type: 'success',
        message: 'Device removed successfully',
      });
    } catch (error) {
      console.error('Error in removeDevice:', error);
      return res.json({
        type: 'error',
        message: error.message,
      });
    }
  }

  /**
   * Send WhatsApp message
   */
  async sendMessage(req, res) {
    try {
      console.log('[WHATSAPP SEND] ========== START ==========');
      console.log('[WHATSAPP SEND] Request body:', redact(req.body));

      const { device_id, phone_number, message, template_id, sale_id } = req.body;

      // Get branch_id with multiple fallbacks
      const branchId = activeBranchId(req);
      const license = req.tenantContext?.licenseId;

      console.log('[WHATSAPP SEND] Branch ID resolved:', branchId);

      if (!phone_number) {
        return res.json({
          type: 'error',
          message: 'Phone number is required',
        });
      }

      if (!message && !template_id) {
        return res.json({
          type: 'error',
          message: 'Message or template is required',
        });
      }

      // If device_id not provided, get it from branch settings
      let deviceId = device_id;
      if (!deviceId) {
        try {
          const Branch = require('../models/branch.model');
          const branch = await Branch.findOne(branchIdentity(req, branchId));
          deviceId = branch?.whatsapp_device_id || 'default_device';
        } catch (error) {
          deviceId = 'default_device';
        }
      }

      if (!branchId) {
        return res.json({
          type: 'error',
          message: 'Branch ID not found. Please ensure you are logged in.',
        });
      }

      let finalMessage = message;

      // If template_id is provided, get template content
      if (template_id) {
        try {
          console.log('Looking for template:', { template_id, branch_id: branchId });
          const Template = require('../models/whatsapp-template.model');
          const { ObjectId } = require('mongoose').Types;

          // Convert template_id to ObjectId
          let templateIdObj;
          try {
            templateIdObj = new ObjectId(template_id);
          } catch (err) {
            console.log('Invalid ObjectId format:', template_id);
            return res.json({
              type: 'error',
              message: 'Invalid template ID format',
            });
          }

          const template = await Template.findOne({ _id: templateIdObj, ...tenantScope(req) });

          if (template) {
            finalMessage = template.message;

            // Get sale data for variable replacement
            console.log('Checking sale_id for variable replacement:', sale_id);
            if (sale_id) {
              try {
                const Sale = require('../models/sale.model');
                console.log('Looking for sale with ID:', sale_id);
                const sale = await Sale.findOne({
                  _id: sale_id,
                  ...(req.tenantContext
                    ? {
                        branch_id: branchId,
                        branch_name: req.tenantContext.branchName,
                        license,
                      }
                    : {}),
                });
                console.log('Found sale data:', sale);

                if (sale) {
                  console.log('Original template message:', finalMessage);

                  // Populate branch if needed
                  if (!sale.branch_id && sale.branch) {
                    await sale.populate('branch_id');
                  }

                  // Calculate totals
                  const subtotal = sale.items_subtotal || sale.subtotal_amount || 0;
                  const discount = sale.discount || 0;
                  const tax = sale.tax || 0;
                  const total = sale.sales_total || 0;

                  // Calculate GST breakdown from items
                  let totalCGST = 0;
                  let totalSGST = 0;
                  let totalIGST = 0;

                  if (sale.items && sale.items.length > 0) {
                    console.log('[GST DEBUG] Sale customer_gst_type:', sale.customer_gst_type);
                    sale.items.forEach((item, idx) => {
                      console.log(`[GST DEBUG] Item ${idx + 1} (${item.item_name}):`, {
                        cgst_tax: item.cgst_tax,
                        sgst_tax: item.sgst_tax,
                        igst_tax: item.igst_tax,
                        tax_amount: item.tax_amount,
                        tax: item.tax,
                        tax_type: item.tax_type,
                        tax_name: item.tax_name,
                      });

                      // First try to use the stored GST values
                      let itemCGST = item.cgst_tax || 0;
                      let itemSGST = item.sgst_tax || 0;
                      let itemIGST = item.igst_tax || 0;

                      // If GST values are 0 but tax exists, calculate from tax_amount
                      if (itemCGST === 0 && itemSGST === 0 && itemIGST === 0) {
                        const taxAmount = item.tax_amount || item.tax || 0;

                        if (taxAmount > 0) {
                          // Check tax type or customer GST type to determine CGST/SGST vs IGST
                          const isIGST =
                            item.tax_type === 'IGST' ||
                            sale.customer_gst_type === 'igst' ||
                            item.tax_name?.toLowerCase().includes('igst');

                          console.log(`[GST DEBUG] Item ${idx + 1} - Tax calculation:`, {
                            taxAmount,
                            isIGST,
                            calculated_cgst: isIGST ? 0 : taxAmount / 2,
                            calculated_sgst: isIGST ? 0 : taxAmount / 2,
                            calculated_igst: isIGST ? taxAmount : 0,
                          });

                          if (isIGST) {
                            itemIGST = taxAmount;
                          } else {
                            // For CGST+SGST, split the tax equally
                            itemCGST = taxAmount / 2;
                            itemSGST = taxAmount / 2;
                          }
                        }
                      }

                      totalCGST += itemCGST;
                      totalSGST += itemSGST;
                      totalIGST += itemIGST;
                    });

                    console.log('[GST DEBUG] Final GST totals:', {
                      totalCGST: totalCGST.toFixed(2),
                      totalSGST: totalSGST.toFixed(2),
                      totalIGST: totalIGST.toFixed(2),
                    });
                  }

                  // Replace template variables with actual data
                  finalMessage = finalMessage.replace(
                    /{customer_name}/g,
                    sale.customer_name || 'Valued Customer'
                  );
                  finalMessage = finalMessage.replace(/{sale_id}/g, sale.sales_id || sale._id);
                  finalMessage = finalMessage.replace(
                    /{sale_date}/g,
                    new Date(sale.date).toLocaleDateString()
                  );
                  finalMessage = finalMessage.replace(/{total_amount}/g, total.toFixed(2));
                  finalMessage = finalMessage.replace(/{company_name}/g, 'Your Company');

                  // Branch details
                  finalMessage = finalMessage.replace(/{branch_name}/g, sale.branch_name || '');
                  finalMessage = finalMessage.replace(
                    /{branch_address}/g,
                    sale.branch_id?.address || ''
                  );
                  finalMessage = finalMessage.replace(
                    /{branch_phone}/g,
                    sale.branch_id?.phone || ''
                  );
                  finalMessage = finalMessage.replace(
                    /{branch_email}/g,
                    sale.branch_id?.email || ''
                  );

                  // Amount breakdown
                  finalMessage = finalMessage.replace(/{subtotal}/g, subtotal.toFixed(2));
                  finalMessage = finalMessage.replace(/{discount}/g, discount.toFixed(2));
                  finalMessage = finalMessage.replace(/{tax}/g, tax.toFixed(2));

                  // GST breakdown
                  finalMessage = finalMessage.replace(/{cgst}/g, totalCGST.toFixed(2));
                  finalMessage = finalMessage.replace(/{sgst}/g, totalSGST.toFixed(2));
                  finalMessage = finalMessage.replace(/{igst}/g, totalIGST.toFixed(2));

                  // Items list
                  if (sale.items && sale.items.length > 0) {
                    console.log('Sale items data:', sale.items);
                    let itemsList = '\n📋 Items:\n';
                    sale.items.forEach((item, index) => {
                      console.log(`Item ${index + 1}:`, item);
                      const itemTotal =
                        item.item_total || item.total_amount || item.total || item.price || '0';
                      console.log(`Item total for ${item.item_name}:`, itemTotal);
                      itemsList += `${index + 1}. ${item.item_name} - Qty: ${item.item_quantity} - ₹${itemTotal}\n`;
                    });
                    finalMessage = finalMessage.replace(/{items_list}/g, itemsList);
                  } else {
                    finalMessage = finalMessage.replace(/{items_list}/g, '');
                  }

                  console.log('Template after variable replacement:', finalMessage);
                } else {
                  console.log('Sale not found with ID:', sale_id);
                }
              } catch (error) {
                console.log('Error getting sale data for template variables:', error);
              }
            } else {
              console.log('No sale_id provided for variable replacement');
            }

            console.log('Template message loaded:', finalMessage);
          } else {
            console.log('Template not found with ID:', template_id);
            return res.json({
              type: 'error',
              message: 'Template not found',
            });
          }
        } catch (error) {
          console.error('Error fetching template:', error);
          return res.json({
            type: 'error',
            message: 'Failed to fetch template: ' + error.message,
          });
        }
      }

      const result = await whatsappService.sendMessage(
        deviceId,
        branchId,
        phone_number,
        finalMessage
      );

      // Add small delay before sending response to prevent frontend detached frame error
      await new Promise((resolve) => setTimeout(resolve, 100));

      return res.json({
        type: result.status ? 'success' : 'error',
        message: result.message,
      });
    } catch (error) {
      console.error('[WHATSAPP SEND] ERROR:', error);
      console.error('[WHATSAPP SEND] Error stack:', error.stack);
      return res.json({
        type: 'error',
        message: error.message,
      });
    }
  }

  /**
   * Save WhatsApp template
   */
  /*
   * Edit a template that already exists.
   *
   * The route for this has been live and calling a method that was never
   * written, so every "Template updated" attempt returned a 500. Express did
   * not catch it at startup because the route wraps the call in an arrow
   * function - the wrapper IS a function, so registration succeeds and the
   * TypeError only surfaces when someone actually presses save.
   *
   * Scoped the same way saveTemplate scopes: the lookup carries templateScope,
   * so a template id from another shop finds nothing rather than being
   * rewritten. Never trust the id alone.
   */
  async updateTemplate(req, res) {
    try {
      const { template_id, name, message, template_type } = req.body;

      if (!template_id) {
        return res.json({ type: 'error', message: 'Template id is required' });
      }
      if (!name || !message) {
        return res.json({
          type: 'error',
          message: 'Template name and message are required',
        });
      }

      const branchId = activeBranchId(req);
      if (!branchId && !req.tenantContext) {
        return res.json({
          type: 'error',
          message: 'Branch ID not found. Please ensure you are logged in.',
        });
      }

      const Template = require('../models/whatsapp-template.model');
      const template = await Template.findOneAndUpdate(
        { _id: template_id, ...templateScope(req) },
        {
          $set: {
            name,
            message,
            template_type: template_type || 'general',
            updated_at: new Date(),
          },
        },
        { new: true }
      );

      if (!template) {
        return res.json({ type: 'error', message: 'Template not found' });
      }

      return res.json({
        type: 'success',
        message: 'Template updated successfully',
        data: template,
      });
    } catch (error) {
      console.error('Error in updateTemplate:', error);
      return res.json({ type: 'error', message: error.message });
    }
  }

  async saveTemplate(req, res) {
    try {
      const { name, message, template_type } = req.body;

      console.log('saveTemplate - Request body:', { name, message, template_type });
      console.log('saveTemplate - Session data:', {
        session: req.session,
        user: req.user,
        selectedBranchId: req.session?.selectedBranchId,
        branch_id: req.session?.branch_id,
        user_branch_id: req.user?.branch_id,
      });

      // Get branch_id from parameter first, then fallback to session
      const branchId = activeBranchId(req);

      console.log('saveTemplate - Resolved branch ID:', branchId);

      if (!branchId) {
        return res.json({
          type: 'error',
          message: 'Branch ID not found. Please ensure you are logged in.',
        });
      }

      if (!name || !message) {
        return res.json({
          type: 'error',
          message: 'Template name and message are required',
        });
      }

      const Template = require('../models/whatsapp-template.model');
      const template = new Template({
        ...templateScope(req),
        name: name,
        message: message,
        template_type: template_type || 'general',
        created_at: new Date(),
        updated_at: new Date(),
      });

      await template.save();

      return res.json({
        type: 'success',
        message: 'Template saved successfully',
        data: template,
      });
    } catch (error) {
      console.error('Error saving template:', error);
      return res.json({
        type: 'error',
        message: error.message,
      });
    }
  }

  /**
   * Get WhatsApp templates
   */
  async getTemplates(req, res) {
    try {
      const branchId = activeBranchId(req);

      console.log('getTemplates - Session:', {
        selectedBranchId: req.session?.selectedBranchId,
        session_branch_id: req.session?.branch_id,
        user_branch_id: req.user?.branch_id,
        resolved_branchId: branchId,
      });

      if (!branchId) {
        return res.json({
          type: 'error',
          message: 'Branch ID not found. Please ensure you are logged in.',
        });
      }

      const Template = require('../models/whatsapp-template.model');
      const templates = await Template.find(templateScope(req)).sort({ created_at: -1 });

      return res.json({
        type: 'success',
        message: 'Templates retrieved successfully',
        data: templates,
      });
    } catch (error) {
      console.error('Error getting templates:', error);
      return res.json({
        type: 'error',
        message: error.message,
      });
    }
  }

  /**
   * Delete WhatsApp template
   */
  async deleteTemplate(req, res) {
    try {
      const { template_id } = req.body;

      if (!template_id) {
        return res.json({
          type: 'error',
          message: 'Template ID is required',
        });
      }

      const Template = require('../models/whatsapp-template.model');
      await Template.deleteOne({ _id: template_id, ...tenantScope(req) });

      return res.json({
        type: 'success',
        message: 'Template deleted successfully',
      });
    } catch (error) {
      console.error('Error deleting template:', error);
      return res.json({
        type: 'error',
        message: error.message,
      });
    }
  }

  /**
   * Get sales receipt template with data
   */
  async getSalesReceiptTemplate(req, res) {
    try {
      const { template_id, sale_id } = req.body;

      if (!template_id || !sale_id) {
        return res.json({
          type: 'error',
          message: 'Template ID and Sale ID are required',
        });
      }

      // Get template
      const Template = require('../models/whatsapp-template.model');
      const template = await Template.findOne({ _id: template_id, ...tenantScope(req) });

      if (!template) {
        return res.json({
          type: 'error',
          message: 'Template not found',
        });
      }

      // Get sale data
      const Sale = require('../models/sale.model');
      const sale = await Sale.findOne({
        _id: sale_id,
        ...(req.tenantContext
          ? {
              branch_id: req.tenantContext.branchId,
              branch_name: req.tenantContext.branchName,
              license: req.tenantContext.licenseId,
            }
          : {}),
      });

      if (!sale) {
        return res.json({
          type: 'error',
          message: 'Sale not found',
        });
      }

      // Replace template variables with actual data
      let message = template.message;

      // Common variables
      message = message.replace(/{customer_name}/g, sale.customer_name || 'Valued Customer');
      message = message.replace(/{sale_id}/g, sale.sales_id || sale._id);
      message = message.replace(/{sale_date}/g, new Date(sale.date).toLocaleDateString());
      message = message.replace(/{total_amount}/g, sale.sales_total || '0');
      message = message.replace(/{company_name}/g, 'Your Company'); // You can get this from settings

      // Items list
      if (sale.items && sale.items.length > 0) {
        let itemsList = '\n📋 Items:\n';
        sale.items.forEach((item, index) => {
          itemsList += `${index + 1}. ${item.item_name} - Qty: ${item.item_quantity} - ₹${item.item_total}\n`;
        });
        message = message.replace(/{items_list}/g, itemsList);
      } else {
        message = message.replace(/{items_list}/g, '');
      }

      return res.json({
        type: 'success',
        message: 'Template processed successfully',
        data: {
          message: message,
          template_name: template.name,
        },
      });
    } catch (error) {
      console.error('Error processing template:', error);
      return res.json({
        type: 'error',
        message: error.message,
      });
    }
  }
}

module.exports = new WhatsAppController();
