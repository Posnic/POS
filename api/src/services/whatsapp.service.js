const EventEmitter = require('events');
const path = require('path');
const fs = require('fs');

class WhatsAppService extends EventEmitter {
  constructor() {
    super();
    this.clients = new Map();
    this.initializations = new Map();
    this.connectionTimers = new Map();
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
    let key;
    try {
      key = this._clientKey(deviceId, branchId);
    } catch (error) {
      return { status: false, message: error.message, connected: false };
    }
    if (this.initializations.has(key)) return this.initializations.get(key);
    const attempt = this._initializeClient(deviceId, branchId);
    this.initializations.set(key, attempt);
    try {
      return await attempt;
    } finally {
      this.initializations.delete(key);
    }
  }

  async _initializeClient(deviceId, branchId) {
    let client;
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

      // A server process can inherit the deploying user's short-lived D-Bus
      // session. Chromium aborts when that session closes. Headless Linux
      // needs no desktop session; leave the parent process environment intact.
      const browserEnv = { ...process.env };
      if (process.platform === 'linux') delete browserEnv.DBUS_SESSION_BUS_ADDRESS;
      let puppeteer;
      try {
        puppeteer = require(
          require.resolve('puppeteer', {
            paths: [path.dirname(require.resolve('whatsapp-web.js'))],
          })
        );
      } catch (_) {
        // The connector can still use a system browser if Puppeteer is unavailable here.
      }
      const executablePath = require('../utils/chrome-executable').chromeExecutable({
        env: browserEnv,
        puppeteer,
      });
      client = new Client({
        authTimeoutMs: 90000,
        webVersionCache: { type: 'none' },
        deviceName: 'Posnic',
        authStrategy: new LocalAuth({
          clientId: clientKey,
          dataPath: this.sessionPath,
        }),
        puppeteer: {
          headless: true,
          executablePath,
          env: browserEnv,
          args:
            process.platform === 'linux'
              ? ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
              : [],
        },
      });

      let rejectDeadline;
      const deadline = new Promise((_, reject) => {
        rejectDeadline = reject;
      });
      const clearDeadline = () => {
        clearTimeout(this.connectionTimers.get(clientKey));
        this.connectionTimers.delete(clientKey);
      };
      const armDeadline = () => {
        clearDeadline();
        const timer = setTimeout(() => {
          if (this.clients.get(clientKey) !== client) return;
          this._safeCleanupClient(clientKey);
          this.connectionStatus.set(clientKey, 'auth_failed');
          rejectDeadline(new Error('WhatsApp connection timed out. Please try again.'));
          // Preserve the saved login; a retry may resume it without another scan.
          void client.destroy().catch(() => {});
        }, 120000);
        timer.unref?.();
        this.connectionTimers.set(clientKey, timer);
      };

      client.on('qr', async (qr) => {
        if (this.clients.get(clientKey) !== client) return;
        clearDeadline();
        console.log(`QR Code received for device: ${deviceId}`);
        this.connectionStatus.set(clientKey, 'qr_ready');
        this.qrCodes.set(clientKey, qr);
        this.emit('qr', { deviceId, clientKey, qrCode: qr });
      });

      client.on('ready', () => {
        if (this.clients.get(clientKey) !== client) return;
        clearDeadline();
        console.log(`WhatsApp ready for device: ${deviceId}`);
        this.connectionStatus.set(clientKey, 'connected');
        this.qrCodes.delete(clientKey);
        this.emit('ready', { deviceId, clientKey });
      });

      client.on('authenticated', () => {
        if (this.clients.get(clientKey) !== client) return;
        this.qrCodes.delete(clientKey);
        armDeadline();
        this.connectionStatus.set(clientKey, 'authenticated');
        this.emit('authenticated', { deviceId, clientKey });
      });

      client.on('auth_failure', (msg) => {
        if (this.clients.get(clientKey) !== client) return;
        console.error(`Auth failure for ${deviceId}:`, msg);
        this.connectionStatus.set(clientKey, 'auth_failed');
        this.qrCodes.delete(clientKey);
        this.emit('auth_failure', { deviceId, clientKey, error: msg });
      });

      client.on('disconnected', (reason) => {
        if (this.clients.get(clientKey) !== client) return;
        console.log(`Disconnected ${deviceId}:`, reason);
        this.connectionStatus.set(clientKey, 'disconnected');
        this.qrCodes.delete(clientKey);
        this._safeCleanupClient(clientKey);
        this.emit('disconnected', { deviceId, clientKey, reason });
      });

      this.clients.set(clientKey, client);
      this.connectionStatus.set(clientKey, 'initializing');

      armDeadline();
      await Promise.race([client.initialize(), deadline]);
      return {
        status: true,
        message: 'Client initialized',
        connected: this.connectionStatus.get(clientKey) === 'connected',
      };
    } catch (error) {
      console.error('Error initializing WhatsApp:', error);
      try {
        const failedKey = this._clientKey(deviceId, branchId);
        const failedClient = this.clients.get(failedKey);
        if (failedClient === client && client) {
          this._safeCleanupClient(failedKey);
          await client.destroy().catch(() => {});
          this.connectionStatus.set(failedKey, 'auth_failed');
        }
      } catch (_) {
        /* Invalid identifiers never create sessions. */
      }
      return { status: false, message: String(error?.message || error), connected: false };
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
      this._safeCleanupClient(clientKey, true);
    }

    // From a UX perspective, clicking "Disconnect" should succeed even if
    // the client was already disconnected or its frame was detached. We
    // therefore return a success status as long as our cleanup completed.
    return { status: true, message: 'Logged out successfully' };
  }

  _safeCleanupClient(clientKey, unlink = false) {
    // Always clean up our in-memory maps regardless of errors so that
    // the system sees this device as disconnected.
    clearTimeout(this.connectionTimers.get(clientKey));
    this.connectionTimers.delete(clientKey);
    this.clients.delete(clientKey);
    this.qrCodes.delete(clientKey);
    this.connectionStatus.delete(clientKey);

    // Preserve authentication on transient disconnects and browser replacement.
    if (!unlink) return;

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

  async sendMessage(deviceId, branchId, phoneNumber, message, document) {
    if (require('../config/demo-mode').isDemoMode()) {
      return { status: false, message: require('../config/demo-mode').DEMO_BLOCKED_MESSAGE };
    }
    const clientKey = this._clientKey(deviceId, branchId);
    let client = this.clients.get(clientKey);
    // A process restart loses the client map, not the phone's saved link.
    // Resume only an existing session; never start a new QR flow as a side
    // effect of sending a receipt. initializeClient deduplicates concurrent
    // recovery, and the message itself is still submitted only once below.
    if (!client && fs.existsSync(path.join(this.sessionPath, `session-${clientKey}`))) {
      await this.initializeClient(deviceId, branchId);
      client = this.clients.get(clientKey);
      if (client && !(await this._waitForReady(clientKey))) {
        return {
          status: false,
          message:
            'WhatsApp is still reconnecting or needs a fresh phone link. No message was sent.',
        };
      }
    }

    if (!client) {
      return {
        status: false,
        message:
          'WhatsApp is not connected. Please go to Settings → WhatsApp Connection and connect your WhatsApp first.',
      };
    }

    if (
      ['initializing', 'authenticated'].includes(this.connectionStatus.get(clientKey)) &&
      !(await this._waitForReady(clientKey))
    ) {
      return {
        status: false,
        message: 'WhatsApp is still reconnecting or needs a fresh phone link. No message was sent.',
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
      // WhatsApp IDs require digits only, even when the UI accepts E.164 + notation.
      const digits = String(phoneNumber || '')
        .replace(/@c\.us$/, '')
        .replace(/[\s()+-]/g, '');
      if (!/^[1-9]\d{7,14}$/.test(digits)) {
        return { status: false, message: 'Enter a valid phone number including country code.' };
      }
      const recipient = await client.getNumberId(digits);
      if (!recipient?._serialized) {
        return {
          status: false,
          message: 'This number could not be found on WhatsApp. Check the country code and number.',
        };
      }
      let chatId = recipient._serialized;
      if (chatId.endsWith('@c.us')) {
        const addresses = await client.getContactLidAndPhone([chatId]);
        const matched = addresses.find((address) => address.pn === chatId);
        if (matched?.lid) chatId = matched.lid;
      }
      if (typeof client.getChatById === 'function') {
        // A linked-device ID can be known before its chat has synced.
        // Resolve the phone chat before sending; never retry an actual send.
        let chat;
        try {
          chat = await client.getChatById(chatId);
        } catch (error) {
          if (chatId === recipient._serialized) throw error;
        }
        if (!chat && chatId !== recipient._serialized) {
          chatId = recipient._serialized;
          chat = await client.getChatById(chatId);
        }
        if (!chat) {
          return {
            status: false,
            message:
              'WhatsApp has not synced this recipient’s chat yet. No message was sent. Allow the linked device to finish syncing.',
          };
        }
      }
      // Sending a receipt must not mark incoming customer messages as read.
      let content = message;
      const options = { sendSeen: false };
      if (document) {
        if (!Buffer.isBuffer(document.buffer) || !document.buffer.length) {
          return {
            status: false,
            message: 'The bill PDF could not be prepared. Nothing was sent.',
          };
        }
        const { MessageMedia } = require('whatsapp-web.js');
        content = new MessageMedia(
          'application/pdf',
          document.buffer.toString('base64'),
          document.filename
        );
        options.sendMediaAsDocument = true;
        options.caption = message;
      }
      const sent = await client.sendMessage(chatId, content, options);
      const messageId = sent?.id?._serialized || sent?.id?.$1;
      if (typeof messageId !== 'string' || !messageId) {
        return {
          status: false,
          uncertain: true,
          message:
            'WhatsApp did not return a message reference. Delivery is unconfirmed; check the chat before retrying.',
        };
      }
      return {
        status: true,
        message: 'Message sent successfully',
        messageId,
      };
    } catch (error) {
      console.error('Error sending message:', error);
      const message = /No LID|toUserLid/i.test(error.message || '')
        ? 'WhatsApp could not resolve this recipient. Confirm the full phone number and let the linked device finish syncing before retrying.'
        : 'WhatsApp could not confirm sending. Check Message history and the recipient before retrying.';
      return { status: false, message };
    }
  }

  _waitForReady(clientKey, timeoutMs = 45000) {
    const status = this.connectionStatus.get(clientKey);
    if (status === 'connected') return Promise.resolve(true);
    if (!['initializing', 'authenticated'].includes(status)) return Promise.resolve(false);
    return new Promise((resolve) => {
      const finish = (ok) => {
        clearTimeout(timer);
        this.off('ready', ready);
        this.off('qr', failed);
        this.off('auth_failure', failed);
        this.off('disconnected', failed);
        resolve(ok);
      };
      const ready = (event) => {
        if (event.clientKey === clientKey) finish(true);
      };
      const failed = (event) => {
        if (event.clientKey === clientKey) finish(false);
      };
      this.on('ready', ready);
      this.on('qr', failed);
      this.on('auth_failure', failed);
      this.on('disconnected', failed);
      const timer = setTimeout(() => finish(false), timeoutMs);
    });
  }
}

module.exports = new WhatsAppService();
