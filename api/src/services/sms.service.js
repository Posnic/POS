const axios = require('axios');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const config = require('../config/config');
const Encryption = require('../utils/encryption');

/**
 * SMS Service for sending transactional SMS via MSG91 or Brevo
 * Matches PHP implementation in setting_model.php:2644-2780
 */
class SmsService {
  constructor() {
    this.provider = config.sms.provider;
    this.s3Client = new S3Client({
      region: config.s3.region,
      credentials: {
        accessKeyId: config.s3.key,
        secretAccessKey: config.s3.secret,
      },
    });
  }

  /**
   * Send a free-form SMS - used by marketing campaigns, not transactional
   * receipts. Brevo transactional SMS accepts arbitrary content, so campaigns
   * go out cleanly through it. MSG91 here is template-only (DLT-approved
   * templates), so free-form campaign SMS through MSG91 is not supported and is
   * reported as such rather than silently dropped or faked.
   *
   * @param {string} phone - recipient, with country code
   * @param {string} message - the fully-rendered message text
   * @returns {Promise<{ ok: boolean, error?: string }>}
   */
  async sendText(phone, message) {
    if (require('../config/demo-mode').isDemoMode()) {
      return { ok: false, error: require('../config/demo-mode').DEMO_BLOCKED_MESSAGE };
    }

    if (!phone) return { ok: false, error: 'No phone number' };
    if (this.provider !== 'brevo') {
      return {
        ok: false,
        error:
          this.provider === 'msg91'
            ? 'MSG91 needs an approved template for campaign SMS'
            : 'No SMS provider configured for campaigns',
      };
    }
    try {
      const response = await axios.post(
        'https://api.brevo.com/v3/transactionalSMS/sms',
        {
          sender: config.sms.brevo.sender,
          recipient: String(phone),
          content: String(message || ''),
          type: 'marketing',
        },
        {
          headers: {
            accept: 'application/json',
            'api-key': config.sms.brevo.apiKey,
            'content-type': 'application/json',
          },
          timeout: 30000,
        }
      );
      const status = response.data && response.data.status;
      return status === 'delivered' || status === 'sent' || status === 'accepted'
        ? { ok: true }
        : { ok: false, error: 'Provider returned ' + (status || 'no status') };
    } catch (error) {
      return {
        ok: false,
        error:
          (error.response && error.response.data && error.response.data.message) || error.message,
      };
    }
  }

  /**
   * Send sales SMS receipt to customer
   * Matches PHP: salesSmsReceiptModel() in setting_model.php:2644-2672
   *
   * @param {Object} data - SMS data
   * @param {string} data.customer_sms_id - Sale ID to encrypt
   * @param {string} data.customer_sms_name - Customer name
   * @param {string} data.customer_sms_fullphone - Customer phone with country code
   * @param {string} data.license - License ID for logging
   * @param {string} data.timezone - Timezone for logging
   * @returns {Promise<Object>} { status, data, message }
   */
  async sendSalesReceipt(data) {
    if (require('../config/demo-mode').isDemoMode()) {
      return { ok: false, error: require('../config/demo-mode').DEMO_BLOCKED_MESSAGE };
    }

    try {
      // Generate encrypted ID (matching PHP line 2649)
      const encryptedId = Encryption.generateEncryptedId(data.customer_sms_id);

      // Send SMS based on provider (matching PHP line 2655)
      let result;
      if (this.provider === 'brevo') {
        result = await this.sendSmsViaBrevo(data, encryptedId);
      } else if (this.provider === 'msg91') {
        result = await this.sendSmsViaMsg91(data, encryptedId);
      } else {
        // If no provider configured, log to S3 only
        await this.logSmsStatusToS3(
          data.customer_sms_fullphone,
          'no_provider',
          data.license,
          data.timezone
        );
        return {
          status: false,
          data: null,
          message: 'No SMS provider configured (brevo or msg91)',
        };
      }

      // Extract status and error details
      const recipientStatus = typeof result === 'string' ? result : result.status;
      const errorDetails = typeof result === 'object' ? result.error : null;

      // Return detailed response
      if (recipientStatus === 'delivered') {
        return {
          status: true,
          data: recipientStatus,
          message: 'Message has been sent',
        };
      } else {
        return {
          status: false,
          data: recipientStatus,
          message: errorDetails || 'SMS delivery failed',
        };
      }
    } catch (error) {
      console.error('Error in sendSalesReceipt:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Send SMS via Brevo (formerly SendinBlue)
   * Matches PHP: sendSmsViaBrevo() in setting_model.php:2682-2705
   *
   * @param {Object} data - SMS data
   * @param {string} encryptedId - Encrypted sale ID
   * @returns {Promise<string>} 'delivered' or 'failed'
   */
  async sendSmsViaBrevo(data, encryptedId) {
    if (require('../config/demo-mode').isDemoMode()) {
      return { ok: false, error: require('../config/demo-mode').DEMO_BLOCKED_MESSAGE };
    }

    try {
      const url = 'https://api.brevo.com/v3/transactionalSMS/sms';
      const receiptUrl = `www.posnic.io/customersMailPrint.html?id=${encryptedId}`;

      const payload = {
        sender: config.sms.brevo.sender,
        recipient: data.customer_sms_fullphone,
        content: `Hi ${data.customer_sms_name},\r\n\r\n Here is your eBill for details click\r\n\r\n${receiptUrl}`,
        type: 'transactional',
      };

      const response = await axios.post(url, payload, {
        headers: {
          accept: 'application/json',
          'api-key': config.sms.brevo.apiKey,
          'content-type': 'application/json',
        },
        timeout: 30000,
      });

      // Check response status (matching PHP line 2704)
      return response.data?.status === 'delivered' ? 'delivered' : 'failed';
    } catch (error) {
      console.error('Brevo SMS Error:', error.response?.data || error.message);
      return 'failed';
    }
  }

  /**
   * Send SMS via MSG91
   * Matches PHP: sendSmsViaMsg91() in setting_model.php:2707-2746
   *
   * @param {Object} data - SMS data
   * @param {string} encryptedId - Encrypted sale ID
   * @returns {Promise<string>} 'delivered' or 'failed'
   */
  async sendSmsViaMsg91(data, encryptedId) {
    if (require('../config/demo-mode').isDemoMode()) {
      return { ok: false, error: require('../config/demo-mode').DEMO_BLOCKED_MESSAGE };
    }

    try {
      // Remove '+' from phone number (matching PHP line 2708)
      const userPhone = data.customer_sms_fullphone.replace('+', '');
      const receiptUrl = `www.posnic.io/customersMailPrint.html?id=${encryptedId}`;

      // Construct payload (matching PHP lines 2711-2723)
      const payload = {
        template_id: config.sms.msg91.templateId,
        short_url: '0',
        realTimeResponse: '1',
        recipients: [
          {
            mobiles: userPhone,
            orderId: data.orderId || data.customer_sms_id,
            name: data.customer_sms_name,
            url: receiptUrl,
          },
        ],
      };

      // Make API request (matching PHP lines 2725-2737)
      const response = await axios.post(config.sms.msg91.apiUrl, payload, {
        headers: {
          Accept: 'application/json',
          Authkey: config.sms.msg91.authKey,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      });

      // Check response (matching PHP lines 2743-2745)
      const success = response.status === 200 && response.data?.type === 'success';

      if (success) {
        return 'delivered';
      } else {
        // Return detailed error information
        return {
          status: 'failed',
          error: response.data?.message || 'MSG91 API error',
          errorType: response.data?.type,
          fullResponse: response.data,
        };
      }
    } catch (error) {
      console.error('MSG91 SMS Error:', error.response?.data?.message || error.message);

      return {
        status: 'failed',
        error: error.response?.data?.message || error.message || 'Network error',
        errorType: error.response?.data?.type || 'exception',
        fullResponse: error.response?.data,
      };
    }
  }

  /**
   * Log SMS status to AWS S3
   * Matches PHP: logSmsStatusToS3() in setting_model.php:2748-2780
   *
   * @param {string} phoneNumber - Customer phone number
   * @param {string} status - 'delivered' or 'failed'
   * @param {string} licenseId - License ID
   * @param {string} timezone - Timezone for timestamp
   */
  async logSmsStatusToS3(phoneNumber, status, licenseId, timezone = 'Asia/Kolkata') {
    try {
      const bucket = config.s3.smsBucket;
      const folder = 'msg91Logs/';
      const key = `${folder}msg91-log-${Date.now()}.json`;

      // Format date with timezone (matching PHP lines 2764-2765)
      const now = new Date();
      const formattedDate = now
        .toLocaleString('en-US', {
          timeZone: timezone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        })
        .replace(/(\d+)\/(\d+)\/(\d+),\s(\d+):(\d+):(\d+)/, '$3-$1-$2T$4:$5:$6');

      // Construct log data (matching PHP lines 2767-2772)
      const logData = {
        client_id: String(licenseId),
        phone_number: phoneNumber,
        status: status,
        sent_at: formattedDate,
      };

      // Upload to S3 (matching PHP lines 2774-2779)
      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: JSON.stringify(logData),
        ContentType: 'application/json',
      });

      await this.s3Client.send(command);
    } catch (error) {
      // Log error but don't throw - S3 logging is not critical
      console.error('S3 SMS Logging Error:', error.message);
    }
  }
}

module.exports = new SmsService();
