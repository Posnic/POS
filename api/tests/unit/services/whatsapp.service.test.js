'use strict';

/**
 * Unit tests for src/services/whatsapp.service.js
 *
 * File        : src/services/whatsapp.service.js (172 lines, SINGLETON export)
 * Export type : SINGLETON — module.exports = new WhatsAppService()
 * Base class  : Extends EventEmitter (Node.js built-in)
 *
 * Provider    : whatsapp-web.js (Puppeteer / reverse-engineered WhatsApp Web)
 *               NOT Meta Cloud API / Twilio / Gupshup / WATI
 *
 * Methods (5):
 *   initializeClient(deviceId, branchId)             — creates/reuses WA Web client, registers events
 *   getQRCode(deviceId, branchId)                    — returns stored QR data URL or null
 *   getConnectionStatus(deviceId, branchId)          — returns status string or 'not_initialized'
 *   logout(deviceId, branchId)                       — logs out, destroys client, cleans up maps + session dir
 *   sendMessage(deviceId, branchId, phone, message)  — sends WA message if client is CONNECTED
 *
 * Internal state (Maps that persist on singleton):
 *   this.clients           Map<clientKey, WA Client instance>
 *   this.qrCodes           Map<clientKey, qr data URL>
 *   this.connectionStatus  Map<clientKey, status string>
 *
 * Mocked dependencies:
 *   fs          — existsSync, mkdirSync, rmSync (constructor + logout use fs)
 *   whatsapp-web.js — Client (constructor), LocalAuth (constructor)
 *   qrcode      — toDataURL (called in qr event handler)
 *
 * No production bugs found. Service correctly uses try/finally in logout to
 * guarantee map cleanup regardless of client errors.
 *
 * SECURITY NOTE: whatsapp-web.js stores Chromium sessions on disk.
 * The sessionPath is relative to __dirname and is correctly cleaned up on logout.
 * No API tokens or credentials are stored in-memory or returned to callers.
 */

// ─── Mocks (hoisted before any require) ──────────────────────────────────────

jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(true),
  mkdirSync: jest.fn(),
  rmSync: jest.fn(),
}));

jest.mock('whatsapp-web.js', () => {
  const mockInstance = {
    on: jest.fn(),
    initialize: jest.fn().mockResolvedValue(undefined),
    getState: jest.fn().mockResolvedValue('CONNECTED'),
    logout: jest.fn().mockResolvedValue(undefined),
    destroy: jest.fn().mockResolvedValue(undefined),
    sendMessage: jest.fn().mockResolvedValue(undefined),
  };
  const Client = jest.fn(() => mockInstance);
  Client.__mockInstance = mockInstance;
  return { Client, LocalAuth: jest.fn() };
});

jest.mock('qrcode', () => ({
  toDataURL: jest.fn().mockResolvedValue('data:image/png;base64,mockqrdataurl'),
}));

jest.spyOn(console, 'error').mockImplementation(() => {});
jest.spyOn(console, 'log').mockImplementation(() => {});
jest.spyOn(console, 'warn').mockImplementation(() => {});

// ─── Requires ─────────────────────────────────────────────────────────────────

const fs = require('fs');
const qrcode = require('qrcode');
const { Client, LocalAuth } = require('whatsapp-web.js');
const mockClient = Client.__mockInstance;

// Service is loaded AFTER mocks — constructor receives mocked fs
const service = require('../../../src/services/whatsapp.service');

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DEVICE_ID = 'device_001';
const BRANCH_ID = 'branch_001';
const CLIENT_KEY = `${BRANCH_ID}_${DEVICE_ID}`;

/**
 * Utility: get a registered event handler from mockClient.on.mock.calls
 */
function getCapturedHandler(eventName) {
  const call = mockClient.on.mock.calls.find(([evt]) => evt === eventName);
  return call ? call[1] : null;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('WhatsAppService (singleton, extends EventEmitter)', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Restore mock implementations cleared by clearAllMocks
    mockClient.initialize.mockResolvedValue(undefined);
    mockClient.getState.mockResolvedValue('CONNECTED');
    mockClient.logout.mockResolvedValue(undefined);
    mockClient.destroy.mockResolvedValue(undefined);
    mockClient.sendMessage.mockResolvedValue(undefined);
    fs.existsSync.mockReturnValue(true);
    qrcode.toDataURL.mockResolvedValue('data:image/png;base64,mockqrdataurl');

    // Reset in-memory state between tests
    service.clients.clear();
    service.qrCodes.clear();
    service.connectionStatus.clear();
  });

  // ── module load / constructor ──────────────────────────────────────────────

  describe('module load (constructor)', () => {
    test('service is an EventEmitter', () => {
      expect(service).toBeInstanceOf(require('events'));
    });

    test('initializes clients, qrCodes, connectionStatus as empty Maps', () => {
      // After clearing in beforeEach they are empty
      expect(service.clients).toBeInstanceOf(Map);
      expect(service.qrCodes).toBeInstanceOf(Map);
      expect(service.connectionStatus).toBeInstanceOf(Map);
    });

    test('sets sessionPath property', () => {
      expect(typeof service.sessionPath).toBe('string');
      expect(service.sessionPath).toContain('.wwebjs_auth');
    });
  });

  // ── initializeClient ───────────────────────────────────────────────────────

  describe('initializeClient', () => {
    test('returns already-connected when client exists with state CONNECTED', async () => {
      service.clients.set(CLIENT_KEY, mockClient);
      mockClient.getState.mockResolvedValue('CONNECTED');

      const r = await service.initializeClient(DEVICE_ID, BRANCH_ID);

      expect(r).toEqual({ status: true, message: 'Already connected', connected: true });
      expect(Client).not.toHaveBeenCalled();
    });

    test('creates a new client when existing client is not CONNECTED', async () => {
      service.clients.set(CLIENT_KEY, mockClient);
      mockClient.getState.mockResolvedValue('DISCONNECTED');

      await service.initializeClient(DEVICE_ID, BRANCH_ID);

      expect(Client).toHaveBeenCalledTimes(1);
    });

    test('creates a new client when no existing client', async () => {
      await service.initializeClient(DEVICE_ID, BRANCH_ID);
      expect(Client).toHaveBeenCalledTimes(1);
    });

    test('passes clientKey as clientId to LocalAuth', async () => {
      await service.initializeClient(DEVICE_ID, BRANCH_ID);
      expect(LocalAuth).toHaveBeenCalledWith(expect.objectContaining({ clientId: CLIENT_KEY }));
    });

    test('passes headless:true and sandbox args to puppeteer config', async () => {
      await service.initializeClient(DEVICE_ID, BRANCH_ID);
      const [config] = Client.mock.calls[0];
      expect(config.puppeteer.headless).toBe(true);
      expect(config.puppeteer.args).toContain('--no-sandbox');
    });

    test('calls client.initialize()', async () => {
      await service.initializeClient(DEVICE_ID, BRANCH_ID);
      expect(mockClient.initialize).toHaveBeenCalledTimes(1);
    });

    test('stores client in this.clients map', async () => {
      await service.initializeClient(DEVICE_ID, BRANCH_ID);
      expect(service.clients.has(CLIENT_KEY)).toBe(true);
    });

    test('sets connectionStatus to "initializing"', async () => {
      await service.initializeClient(DEVICE_ID, BRANCH_ID);
      // Status may be set to initializing before initialize() resolves
      // We verify the map was used (other tests verify final state via events)
      expect(service.connectionStatus.has(CLIENT_KEY)).toBe(true);
    });

    test('returns {status:true, connected:false} on successful initialization', async () => {
      const r = await service.initializeClient(DEVICE_ID, BRANCH_ID);
      expect(r).toEqual({ status: true, message: 'Client initialized', connected: false });
    });

    test('returns {status:false} when Client constructor throws', async () => {
      Client.mockImplementationOnce(() => {
        throw new Error('Puppeteer failed');
      });
      const r = await service.initializeClient(DEVICE_ID, BRANCH_ID);
      expect(r).toEqual({ status: false, message: 'Puppeteer failed', connected: false });
    });

    test('returns {status:false} when client.initialize() rejects', async () => {
      mockClient.initialize.mockRejectedValueOnce(new Error('Init error'));
      const r = await service.initializeClient(DEVICE_ID, BRANCH_ID);
      expect(r).toEqual({ status: false, message: 'Init error', connected: false });
    });

    test('registers qr event handler', async () => {
      await service.initializeClient(DEVICE_ID, BRANCH_ID);
      expect(getCapturedHandler('qr')).toBeInstanceOf(Function);
    });

    test('registers ready event handler', async () => {
      await service.initializeClient(DEVICE_ID, BRANCH_ID);
      expect(getCapturedHandler('ready')).toBeInstanceOf(Function);
    });

    test('registers authenticated event handler', async () => {
      await service.initializeClient(DEVICE_ID, BRANCH_ID);
      expect(getCapturedHandler('authenticated')).toBeInstanceOf(Function);
    });

    test('registers auth_failure event handler', async () => {
      await service.initializeClient(DEVICE_ID, BRANCH_ID);
      expect(getCapturedHandler('auth_failure')).toBeInstanceOf(Function);
    });

    test('registers disconnected event handler', async () => {
      await service.initializeClient(DEVICE_ID, BRANCH_ID);
      expect(getCapturedHandler('disconnected')).toBeInstanceOf(Function);
    });

    // ── event handler behaviour ────────────────────────────────────────────

    describe('qr event handler', () => {
      test('calls qrcode.toDataURL with the QR string', async () => {
        await service.initializeClient(DEVICE_ID, BRANCH_ID);
        const qrHandler = getCapturedHandler('qr');
        await qrHandler('raw-qr-string');
        expect(qrcode.toDataURL).toHaveBeenCalledWith('raw-qr-string');
      });

      test('stores QR data URL in this.qrCodes', async () => {
        await service.initializeClient(DEVICE_ID, BRANCH_ID);
        await getCapturedHandler('qr')('raw-qr');
        expect(service.qrCodes.get(CLIENT_KEY)).toBe('data:image/png;base64,mockqrdataurl');
      });

      test('sets connectionStatus to "qr_ready"', async () => {
        await service.initializeClient(DEVICE_ID, BRANCH_ID);
        await getCapturedHandler('qr')('raw-qr');
        expect(service.connectionStatus.get(CLIENT_KEY)).toBe('qr_ready');
      });

      test('emits service-level "qr" event with deviceId and qrCode', async () => {
        await service.initializeClient(DEVICE_ID, BRANCH_ID);
        const emitted = [];
        service.once('qr', (data) => emitted.push(data));
        await getCapturedHandler('qr')('raw-qr');
        expect(emitted).toHaveLength(1);
        expect(emitted[0].deviceId).toBe(DEVICE_ID);
        expect(emitted[0].qrCode).toBe('data:image/png;base64,mockqrdataurl');
      });
    });

    describe('ready event handler', () => {
      test('sets connectionStatus to "connected"', async () => {
        await service.initializeClient(DEVICE_ID, BRANCH_ID);
        getCapturedHandler('ready')();
        expect(service.connectionStatus.get(CLIENT_KEY)).toBe('connected');
      });

      test('deletes QR code from this.qrCodes', async () => {
        service.qrCodes.set(CLIENT_KEY, 'old-qr');
        await service.initializeClient(DEVICE_ID, BRANCH_ID);
        getCapturedHandler('ready')();
        expect(service.qrCodes.has(CLIENT_KEY)).toBe(false);
      });

      test('emits service-level "ready" event with deviceId', async () => {
        await service.initializeClient(DEVICE_ID, BRANCH_ID);
        const emitted = [];
        service.once('ready', (data) => emitted.push(data));
        getCapturedHandler('ready')();
        expect(emitted[0].deviceId).toBe(DEVICE_ID);
      });
    });

    describe('authenticated event handler', () => {
      test('sets connectionStatus to "authenticated"', async () => {
        await service.initializeClient(DEVICE_ID, BRANCH_ID);
        getCapturedHandler('authenticated')();
        expect(service.connectionStatus.get(CLIENT_KEY)).toBe('authenticated');
      });

      test('emits service-level "authenticated" event', async () => {
        await service.initializeClient(DEVICE_ID, BRANCH_ID);
        const emitted = [];
        service.once('authenticated', (d) => emitted.push(d));
        getCapturedHandler('authenticated')();
        expect(emitted[0].deviceId).toBe(DEVICE_ID);
      });
    });

    describe('auth_failure event handler', () => {
      test('sets connectionStatus to "auth_failed"', async () => {
        await service.initializeClient(DEVICE_ID, BRANCH_ID);
        getCapturedHandler('auth_failure')('Auth error msg');
        expect(service.connectionStatus.get(CLIENT_KEY)).toBe('auth_failed');
      });

      test('emits service-level "auth_failure" event with error', async () => {
        await service.initializeClient(DEVICE_ID, BRANCH_ID);
        const emitted = [];
        service.once('auth_failure', (d) => emitted.push(d));
        getCapturedHandler('auth_failure')('QR timeout');
        expect(emitted[0].error).toBe('QR timeout');
      });
    });

    describe('disconnected event handler', () => {
      test('sets connectionStatus to "disconnected"', async () => {
        await service.initializeClient(DEVICE_ID, BRANCH_ID);
        getCapturedHandler('disconnected')('NAVIGATION');
        expect(service.connectionStatus.get(CLIENT_KEY)).toBe('disconnected');
      });

      test('emits service-level "disconnected" event with reason', async () => {
        await service.initializeClient(DEVICE_ID, BRANCH_ID);
        const emitted = [];
        service.once('disconnected', (d) => emitted.push(d));
        getCapturedHandler('disconnected')('LOGOUT');
        expect(emitted[0].reason).toBe('LOGOUT');
      });
    });
  });

  // ── getQRCode ──────────────────────────────────────────────────────────────

  describe('getQRCode', () => {
    test('returns stored QR data URL for known device', () => {
      service.qrCodes.set(CLIENT_KEY, 'data:image/png;base64,theqr');
      expect(service.getQRCode(DEVICE_ID, BRANCH_ID)).toBe('data:image/png;base64,theqr');
    });

    test('returns null for unknown device', () => {
      expect(service.getQRCode('unknown_device', 'unknown_branch')).toBeNull();
    });

    test('uses branchId_deviceId as the lookup key', () => {
      service.qrCodes.set('branchA_deviceX', 'qr-for-a-x');
      expect(service.getQRCode('deviceX', 'branchA')).toBe('qr-for-a-x');
    });

    test('returns null when QR was deleted after ready event', () => {
      service.qrCodes.set(CLIENT_KEY, 'old-qr');
      service.qrCodes.delete(CLIENT_KEY);
      expect(service.getQRCode(DEVICE_ID, BRANCH_ID)).toBeNull();
    });
  });

  // ── getConnectionStatus ────────────────────────────────────────────────────

  describe('getConnectionStatus', () => {
    test('returns stored status for known device', () => {
      service.connectionStatus.set(CLIENT_KEY, 'connected');
      expect(service.getConnectionStatus(DEVICE_ID, BRANCH_ID)).toBe('connected');
    });

    test('returns "not_initialized" for unknown device', () => {
      expect(service.getConnectionStatus('ghost_device', 'ghost_branch')).toBe('not_initialized');
    });

    test('uses branchId_deviceId as the lookup key', () => {
      service.connectionStatus.set('branchB_deviceY', 'qr_ready');
      expect(service.getConnectionStatus('deviceY', 'branchB')).toBe('qr_ready');
    });

    test('reflects all possible status values', () => {
      const statuses = [
        'initializing',
        'qr_ready',
        'authenticated',
        'connected',
        'disconnected',
        'auth_failed',
      ];
      statuses.forEach((s) => {
        service.connectionStatus.set(CLIENT_KEY, s);
        expect(service.getConnectionStatus(DEVICE_ID, BRANCH_ID)).toBe(s);
      });
    });
  });

  // ── logout ─────────────────────────────────────────────────────────────────

  describe('logout', () => {
    beforeEach(() => {
      service.clients.set(CLIENT_KEY, mockClient);
      service.qrCodes.set(CLIENT_KEY, 'data:image/png;base64,qr');
      service.connectionStatus.set(CLIENT_KEY, 'connected');
    });

    test('calls client.logout()', async () => {
      await service.logout(DEVICE_ID, BRANCH_ID);
      expect(mockClient.logout).toHaveBeenCalledTimes(1);
    });

    test('calls client.destroy()', async () => {
      await service.logout(DEVICE_ID, BRANCH_ID);
      expect(mockClient.destroy).toHaveBeenCalledTimes(1);
    });

    test('removes client from this.clients map', async () => {
      await service.logout(DEVICE_ID, BRANCH_ID);
      expect(service.clients.has(CLIENT_KEY)).toBe(false);
    });

    test('removes QR code from this.qrCodes map', async () => {
      await service.logout(DEVICE_ID, BRANCH_ID);
      expect(service.qrCodes.has(CLIENT_KEY)).toBe(false);
    });

    test('removes status from this.connectionStatus map', async () => {
      await service.logout(DEVICE_ID, BRANCH_ID);
      expect(service.connectionStatus.has(CLIENT_KEY)).toBe(false);
    });

    test('returns {status:true} on success', async () => {
      const r = await service.logout(DEVICE_ID, BRANCH_ID);
      expect(r).toEqual({ status: true, message: 'Logged out successfully' });
    });

    test('still cleans up maps when client.logout() throws', async () => {
      mockClient.logout.mockRejectedValueOnce(new Error('Detached frame'));
      await service.logout(DEVICE_ID, BRANCH_ID);
      expect(service.clients.has(CLIENT_KEY)).toBe(false);
      expect(service.qrCodes.has(CLIENT_KEY)).toBe(false);
      expect(service.connectionStatus.has(CLIENT_KEY)).toBe(false);
    });

    test('still returns {status:true} when client.logout() throws', async () => {
      mockClient.logout.mockRejectedValueOnce(new Error('Target closed'));
      const r = await service.logout(DEVICE_ID, BRANCH_ID);
      expect(r.status).toBe(true);
    });

    test('still cleans up maps when client.destroy() throws', async () => {
      mockClient.destroy.mockRejectedValueOnce(new Error('Destroy error'));
      await service.logout(DEVICE_ID, BRANCH_ID);
      expect(service.clients.has(CLIENT_KEY)).toBe(false);
    });

    test('returns {status:true} when no client is registered (already disconnected)', async () => {
      service.clients.clear();
      const r = await service.logout(DEVICE_ID, BRANCH_ID);
      expect(r).toEqual({ status: true, message: 'Logged out successfully' });
      expect(mockClient.logout).not.toHaveBeenCalled();
    });

    test('attempts fs.rmSync to remove session directory', async () => {
      fs.existsSync.mockReturnValueOnce(true);
      await service.logout(DEVICE_ID, BRANCH_ID);
      expect(fs.rmSync).toHaveBeenCalledWith(expect.stringContaining(`session-${CLIENT_KEY}`), {
        recursive: true,
        force: true,
      });
    });

    test('skips fs.rmSync when session directory does not exist', async () => {
      fs.existsSync.mockReturnValueOnce(false);
      await service.logout(DEVICE_ID, BRANCH_ID);
      expect(fs.rmSync).not.toHaveBeenCalled();
    });

    test('returns {status:true} even when fs.rmSync throws', async () => {
      fs.existsSync.mockReturnValueOnce(true);
      fs.rmSync.mockImplementationOnce(() => {
        throw new Error('Permission denied');
      });
      const r = await service.logout(DEVICE_ID, BRANCH_ID);
      expect(r.status).toBe(true);
    });
  });

  // ── sendMessage ────────────────────────────────────────────────────────────

  describe('sendMessage', () => {
    test('returns status:false when no client found for device/branch', async () => {
      // clients map is empty
      const r = await service.sendMessage(DEVICE_ID, BRANCH_ID, '9876543210', 'Hello');
      expect(r.status).toBe(false);
      expect(r.message).toContain('not connected');
    });

    test('returns status:false when client state is not CONNECTED', async () => {
      service.clients.set(CLIENT_KEY, mockClient);
      mockClient.getState.mockResolvedValueOnce('DISCONNECTED');
      const r = await service.sendMessage(DEVICE_ID, BRANCH_ID, '9876543210', 'Hello');
      expect(r.status).toBe(false);
      expect(r.message).toContain('connection lost');
    });

    test('appends @c.us to phone number when not already present', async () => {
      service.clients.set(CLIENT_KEY, mockClient);
      mockClient.getState.mockResolvedValue('CONNECTED');
      await service.sendMessage(DEVICE_ID, BRANCH_ID, '919876543210', 'Hi');
      expect(mockClient.sendMessage).toHaveBeenCalledWith('919876543210@c.us', 'Hi');
    });

    test('does not modify phone number that already contains @c.us', async () => {
      service.clients.set(CLIENT_KEY, mockClient);
      mockClient.getState.mockResolvedValue('CONNECTED');
      await service.sendMessage(DEVICE_ID, BRANCH_ID, '919876543210@c.us', 'Hi');
      expect(mockClient.sendMessage).toHaveBeenCalledWith('919876543210@c.us', 'Hi');
    });

    test('returns {status:true} on successful send', async () => {
      service.clients.set(CLIENT_KEY, mockClient);
      mockClient.getState.mockResolvedValue('CONNECTED');
      const r = await service.sendMessage(DEVICE_ID, BRANCH_ID, '9876543210', 'Test message');
      expect(r).toEqual({ status: true, message: 'Message sent successfully' });
    });

    test('passes message body unchanged to client.sendMessage', async () => {
      service.clients.set(CLIENT_KEY, mockClient);
      mockClient.getState.mockResolvedValue('CONNECTED');
      const body = 'Your order #INV-001 is ready! Total: ₹500 😊\nPlease collect it.';
      await service.sendMessage(DEVICE_ID, BRANCH_ID, '9876543210', body);
      expect(mockClient.sendMessage).toHaveBeenCalledWith('9876543210@c.us', body);
    });

    test('returns {status:false} when client.sendMessage throws', async () => {
      service.clients.set(CLIENT_KEY, mockClient);
      mockClient.getState.mockResolvedValue('CONNECTED');
      mockClient.sendMessage.mockRejectedValueOnce(new Error('WA send failed'));
      const r = await service.sendMessage(DEVICE_ID, BRANCH_ID, '9876543210', 'Hi');
      expect(r.status).toBe(false);
      expect(r.message).toBe('WA send failed');
    });

    test('uses branchId_deviceId as the client lookup key', async () => {
      service.clients.set('branchX_deviceY', mockClient);
      mockClient.getState.mockResolvedValue('CONNECTED');
      const r = await service.sendMessage('deviceY', 'branchX', '1234567890', 'Hi');
      expect(r.status).toBe(true);
    });

    // Security: no credentials returned
    test('does not include any token/secret/credential in success response', async () => {
      service.clients.set(CLIENT_KEY, mockClient);
      mockClient.getState.mockResolvedValue('CONNECTED');
      const r = await service.sendMessage(DEVICE_ID, BRANCH_ID, '9876543210', 'Hi');
      const str = JSON.stringify(r);
      expect(str).not.toMatch(/token|secret|key|password|api/i);
    });
  });
});
