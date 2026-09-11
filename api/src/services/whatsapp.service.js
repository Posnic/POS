const EventEmitter = require('events');
const path = require('path');
const fs = require('fs');

class WhatsAppService extends EventEmitter {
  constructor() {
    super();
    this.clients = new Map();
    this.qrCodes = new Map();
    this.connectionStatus = new Map();
    this.sessionPath = path.join(__dirname, '../../.wwebjs_auth');

    if (!fs.existsSync(this.sessionPath)) {
      fs.mkdirSync(this.sessionPath, { recursive: true });
    }
  }

  /*
   * The session key, and the only place it is built.
   *
   * clientKey becomes a directory name: path.join(sessionPath,
   * `session-${clientKey}`), and logout() calls fs.rmSync on that path with
   * recursive and force. deviceId arrives from req.body, so a device id of
   * "../../.." resolved to somewhere outside the session folder and deleted
   * it - an authenticated request able to remove an arbitrary directory tree,
   * which is as bad as this application gets.
   *
   * An allowlist rather than stripping "..": stripping is a filter somebody
   * has to get exactly right, and "....//" defeats the obvious version. These
   * are ids we generate, so they can be required to look like ids.
   */
  _clientKey(deviceId, branchId) {
    const safe = (value, what) => {
      const text = String(value == null ? '' : value);
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(text)) {
        throw new Error(`${what} is not a valid identifier`);
      }
      return text;
    };
    return `${safe(branchId, 'branch id')}_${safe(deviceId, 'device id')}`;
  }

  async initializeClient(deviceId, branchId) {
    try {
      const { Client, LocalAuth } = require('whatsapp-web.js');
      const qrcode = require('qrcode');

      const clientKey = this._clientKey(deviceId, branchId);

      if (this.clients.has(clientKey)) {
        const existingClient = this.clients.get(clientKey);
        try {
          const state = await existingClient.getState();
          if (state === 'CONNECTED') {
            return { status: true, message: 'Already connected', connected: true };
          }
        } catch (err) {
          console.warn(
            `[WHATSAPP INIT] Existing client state check failed for ${clientKey}, recreating:`,
            err?.message || err
          );
        }

        // Replace stale/inactive client sessions so a fresh QR can be generated.
        try {
          await existingClient.destroy();
        } catch (err) {
          console.warn(
            `[WHATSAPP INIT] Existing client destroy failed for ${clientKey}, continuing:`,
            err?.message || err
          );
        }

        this._safeCleanupClient(clientKey);
      }

      // Ensure we don't have leftover QR/status from a prior attempt.
      this.qrCodes.delete(clientKey);
      this.connectionStatus.delete(clientKey);

      const client = new Client({
        authStrategy: new LocalAuth({
          clientId: clientKey,
          dataPath: this.sessionPath,
        }),
        puppeteer: {
          headless: true,
          args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
        },
      });

      client.on('qr', async (qr) => {
        console.log(`QR Code received for device: ${deviceId}`);
        this.connectionStatus.set(clientKey, 'qr_ready');
        this.qrCodes.set(clientKey, qr);
        this.emit('qr', { deviceId, clientKey, qrCode: qr });
      });

      client.on('ready', () => {
        console.log(`WhatsApp ready for device: ${deviceId}`);
        this.connectionStatus.set(clientKey, 'connected');
        this.qrCodes.delete(clientKey);
        this.emit('ready', { deviceId, clientKey });
      });

      client.on('authenticated', () => {
        this.connectionStatus.set(clientKey, 'authenticated');
        this.emit('authenticated', { deviceId, clientKey });
      });

      client.on('auth_failure', (msg) => {
        console.error(`Auth failure for ${deviceId}:`, msg);
        this.connectionStatus.set(clientKey, 'auth_failed');
        this.qrCodes.delete(clientKey);
        this.emit('auth_failure', { deviceId, clientKey, error: msg });
      });

      client.on('disconnected', (reason) => {
        console.log(`Disconnected ${deviceId}:`, reason);
        this.connectionStatus.set(clientKey, 'disconnected');
        this.qrCodes.delete(clientKey);
        this._safeCleanupClient(clientKey);
        this.emit('disconnected', { deviceId, clientKey, reason });
      });

      this.clients.set(clientKey, client);
      this.connectionStatus.set(clientKey, 'initializing');

      await client.initialize();
      return {
        status: true,
        message: 'Client initialized',
        connected: false,
      };
    } catch (error) {
      console.error('Error initializing WhatsApp:', error);
      return { status: false, message: error.message, connected: false };
    }
  }

  getQRCode(deviceId, branchId) {
    const clientKey = this._clientKey(deviceId, branchId);
    return this.qrCodes.get(clientKey) || null;
  }

  getConnectionStatus(deviceId, branchId) {
    const clientKey = this._clientKey(deviceId, branchId);
    return this.connectionStatus.get(clientKey) || 'not_initialized';
  }

  async logout(deviceId, branchId) {
    const clientKey = this._clientKey(deviceId, branchId);
    const client = this.clients.get(clientKey);

    try {
      if (client) {
        // whatsapp-web.js / puppeteer can throw errors like
        // "Attempted to use detached Frame" or "Target closed" if the
        // underlying Chromium page is already gone. For a "Disconnect"
        // action in the UI, these are safe to ignore - the user simply
        // wants the session cleared.
        try {
          await client.logout();
        } catch (err) {
          console.warn(
            '[WHATSAPP LOGOUT] Error during client.logout(), ignoring:',
            err?.message || err
          );
        }

        try {
          await client.destroy();
        } catch (err) {
          console.warn(
            '[WHATSAPP LOGOUT] Error during client.destroy(), ignoring:',
            err?.message || err
          );
        }
      }
    } finally {
      this._safeCleanupClient(clientKey);
    }

    // From a UX perspective, clicking "Disconnect" should succeed even if
    // the client was already disconnected or its frame was detached. We
    // therefore return a success status as long as our cleanup completed.
    return { status: true, message: 'Logged out successfully' };
  }

  _safeCleanupClient(clientKey) {
    // Always clean up our in-memory maps regardless of errors so that
    // the system sees this device as disconnected.
    this.clients.delete(clientKey);
    this.qrCodes.delete(clientKey);
    this.connectionStatus.delete(clientKey);

    // Also attempt to remove the on-disk session folder. Any failure
    // here is logged but not surfaced to the user.
    try {
      const sessionDir = path.join(this.sessionPath, `session-${clientKey}`);
      if (fs.existsSync(sessionDir)) {
        fs.rmSync(sessionDir, { recursive: true, force: true });
      }
    } catch (err) {
      console.warn(
        '[WHATSAPP LOGOUT] Error removing session directory, ignoring:',
        err?.message || err
      );
    }
  }

  async sendMessage(deviceId, branchId, phoneNumber, message) {
    if (require('../config/demo-mode').isDemoMode()) {
      return { status: false, message: require('../config/demo-mode').DEMO_BLOCKED_MESSAGE };
    }
    const clientKey = this._clientKey(deviceId, branchId);
    const client = this.clients.get(clientKey);

    if (!client) {
      return {
        status: false,
        message:
          'WhatsApp is not connected. Please go to Settings → WhatsApp Connection and connect your WhatsApp first.',
      };
    }

    const state = await client.getState();
    if (state !== 'CONNECTED') {
      return {
        status: false,
        message: 'WhatsApp connection lost. Please reconnect from Settings → WhatsApp Connection.',
      };
    }

    try {
      const chatId = phoneNumber.includes('@c.us') ? phoneNumber : `${phoneNumber}@c.us`;
      await client.sendMessage(chatId, message);
      return { status: true, message: 'Message sent successfully' };
    } catch (error) {
      console.error('Error sending message:', error);
      return { status: false, message: error.message };
    }
  }
}

module.exports = new WhatsAppService();
