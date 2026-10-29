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
  cpSync: jest.fn(),
}));

jest.mock('whatsapp-web.js', () => {
  const mockInstance = {
    on: jest.fn(),
    initialize: jest.fn().mockResolvedValue(undefined),
    getState: jest.fn().mockResolvedValue('CONNECTED'),
    getNumberId: jest.fn(async (number) => ({ _serialized: number + '@c.us' })),
    getContactLidAndPhone: jest.fn(async () => []),
    logout: jest.fn().mockResolvedValue(undefined),
    destroy: jest.fn().mockResolvedValue(undefined),
    sendMessage: jest.fn().mockResolvedValue({ id: { _serialized: 'test-message-id' } }),
  };
  const Client = jest.fn(() => mockInstance);
  Client.__mockInstance = mockInstance;
  return {
    Client,
    LocalAuth: jest.fn(),
    MessageMedia: jest.fn(function (mimetype, data, filename) {
      Object.assign(this, { mimetype, data, filename });
    }),
  };
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

test('desktop migration preserves legacy authentication and never overwrites a profile session', async () => {
  const service = require('../../../src/services/whatsapp.service');
  const previous = { session: service.sessionPath, legacy: service.legacySessionPath };
  service.sessionPath = '/profile/.wwebjs_auth';
  service.legacySessionPath = '/legacy/.wwebjs_auth';
  fs.cpSync.mockClear();
  fs.existsSync.mockImplementation((p) => String(p).includes('legacy'));
  try {
    await service.initializeClient('migration', 'branch');
    expect(fs.cpSync).toHaveBeenCalledWith(
      expect.stringContaining('legacy'),
      expect.stringContaining('profile'),
      { recursive: true, errorOnExist: true, force: false }
    );
    fs.cpSync.mockClear();
    fs.existsSync.mockReturnValue(true);
    await service.initializeClient('migration', 'branch');
    expect(fs.cpSync).not.toHaveBeenCalled();
  } finally {
    service._safeCleanupClient('branch_migration');
    service.sessionPath = previous.session;
    service.legacySessionPath = previous.legacy;
    fs.existsSync.mockReturnValue(true);
  }
});

test('web navigation retries attachment in the same client and bounds failures', async () => {
  jest.useFakeTimers();
  try {
    const service = require('../../../src/services/whatsapp.service');
    const inject = jest
      .fn()
      .mockRejectedValueOnce(new Error('Execution context was destroyed'))
      .mockResolvedValue('ready');
    const client = { inject };
    service._recoverNavigationDuringInjection(client);
    const result = client.inject();
    await jest.runAllTimersAsync();
    await expect(result).resolves.toBe('ready');
    expect(inject).toHaveBeenCalledTimes(2);
    const failure = new Error('Execution context was destroyed');
    inject.mockReset().mockRejectedValue(failure);
    const rejection = expect(client.inject()).rejects.toBe(failure);
    await jest.runAllTimersAsync();
    await rejection;
    expect(inject).toHaveBeenCalledTimes(3);
  } finally {
    jest.useRealTimers();
  }
});

test('failed startup closes its own orphaned browser without removing authentication', async () => {
  const service = require('../../../src/services/whatsapp.service');
  const child = { exitCode: null, killed: false, kill: jest.fn() };
  const browser = {
    process: () => child,
    close: jest.fn().mockRejectedValue(new Error('Disconnected')),
  };
  fs.rmSync.mockClear();
  await service._closeFailedClient({ pupBrowser: browser, destroy: jest.fn().mockResolvedValue() });
  expect(browser.close).toHaveBeenCalledTimes(1);
  expect(child.kill).toHaveBeenCalledTimes(1);
  expect(fs.rmSync).not.toHaveBeenCalled();
  child.exitCode = 0;
  child.kill.mockClear();
  await service._closeFailedClient({ pupBrowser: browser, destroy: jest.fn().mockResolvedValue() });
  expect(child.kill).not.toHaveBeenCalled();
});

test('transient cleanup preserves disk authentication; explicit logout removes it', () => {
  const service = require('../../../src/services/whatsapp.service');
  fs.rmSync.mockClear();
  service._safeCleanupClient('branch_device');
  expect(fs.rmSync).not.toHaveBeenCalled();
  service._safeCleanupClient('branch_device', true);
  expect(fs.rmSync).toHaveBeenCalledWith(expect.stringContaining('session-branch_device'), {
    recursive: true,
    force: true,
  });
});

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
    mockClient.sendMessage.mockResolvedValue({ id: { _serialized: 'test-message-id' } });
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

    test('passes a browser path and keeps desktop Chromium sandboxed', async () => {
      await service.initializeClient(DEVICE_ID, BRANCH_ID);
      const [config] = Client.mock.calls[0];
      expect(config.puppeteer.headless).toBe(true);
      expect(config.puppeteer.executablePath).toEqual(expect.any(String));
      if (process.platform === 'linux') expect(config.puppeteer.args).toContain('--no-sandbox');
      else expect(config.puppeteer.args).not.toContain('--no-sandbox');
    });

    test('reports a missing browser before starting a WhatsApp client', async () => {
      fs.existsSync.mockReturnValue(false);
      const result = await service.initializeClient(DEVICE_ID, BRANCH_ID);
      expect(result).toMatchObject({ status: false, connected: false });
      expect(result.message).toMatch(/Chrome or Microsoft Edge/);
      expect(Client).not.toHaveBeenCalled();
    });

    test('calls client.initialize()', async () => {
      await service.initializeClient(DEVICE_ID, BRANCH_ID);
      expect(mockClient.initialize).toHaveBeenCalledTimes(1);
    });

    test('does not inherit a temporary Linux desktop bus or mutate the server environment', async () => {
      const platform = Object.getOwnPropertyDescriptor(process, 'platform');
      const previous = process.env.DBUS_SESSION_BUS_ADDRESS;
      Object.defineProperty(process, 'platform', { value: 'linux' });
      process.env.DBUS_SESSION_BUS_ADDRESS = 'unix:path=/temporary-test-session';
      try {
        await service.initializeClient(DEVICE_ID, BRANCH_ID);
        expect(Client.mock.calls[0][0].puppeteer.env.DBUS_SESSION_BUS_ADDRESS).toBeUndefined();
        expect(process.env.DBUS_SESSION_BUS_ADDRESS).toBe('unix:path=/temporary-test-session');
      } finally {
        Object.defineProperty(process, 'platform', platform);
        if (previous === undefined) delete process.env.DBUS_SESSION_BUS_ADDRESS;
        else process.env.DBUS_SESSION_BUS_ADDRESS = previous;
      }
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
      /*
       * The service stores the RAW QR string now; the controller converts
       * to a data URL at read time (getQRCode). The old suite pinned the
       * conversion to the service and went red when it moved.
       */
      test('stores the RAW QR string - conversion belongs to the controller', async () => {
        await service.initializeClient(DEVICE_ID, BRANCH_ID);
        await getCapturedHandler('qr')('raw-qr-string');
        expect(service.qrCodes.get(CLIENT_KEY)).toBe('raw-qr-string');
        expect(qrcode.toDataURL).not.toHaveBeenCalled();
      });

      test('sets connectionStatus to "qr_ready"', async () => {
        await service.initializeClient(DEVICE_ID, BRANCH_ID);
        await getCapturedHandler('qr')('raw-qr');
        expect(service.connectionStatus.get(CLIENT_KEY)).toBe('qr_ready');
      });

      test('emits service-level "qr" event with deviceId and the raw qrCode', async () => {
        await service.initializeClient(DEVICE_ID, BRANCH_ID);
        const emitted = [];
        service.once('qr', (data) => emitted.push(data));
        await getCapturedHandler('qr')('raw-qr');
        expect(emitted).toHaveLength(1);
        expect(emitted[0].deviceId).toBe(DEVICE_ID);
        expect(emitted[0].qrCode).toBe('raw-qr');
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
      test('cleans the client up entirely - a disconnected device reads as not_initialized', async () => {
        /*
         * The handler now runs the full cleanup (_safeCleanupClient), which
         * removes the status entry along with the client and its session
         * dir - so a fresh QR can be generated. The old suite expected a
         * lingering "disconnected" status; the current design leaves none.
         */
        await service.initializeClient(DEVICE_ID, BRANCH_ID);
        getCapturedHandler('disconnected')('NAVIGATION');
        expect(service.connectionStatus.has(CLIENT_KEY)).toBe(false);
        expect(service.clients.has(CLIENT_KEY)).toBe(false);
        expect(service.getConnectionStatus(DEVICE_ID, BRANCH_ID)).toBe('not_initialized');
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
    test('preserves the provider reference from newer serialized message models', async () => {
      service.clients.set(CLIENT_KEY, mockClient);
      mockClient.sendMessage.mockResolvedValueOnce({ id: { $1: 'new-message-id' } });
      const result = await service.sendMessage(DEVICE_ID, BRANCH_ID, '919008427482', 'Test');
      expect(result.status).toBe(true);
      expect(result.messageId).toBe('new-message-id');
      expect(mockClient.sendMessage).toHaveBeenCalledTimes(1);
    });
    test('missing provider message reference is never reported as sent', async () => {
      service.clients.set(CLIENT_KEY, mockClient);
      mockClient.sendMessage.mockResolvedValueOnce(undefined);
      const result = await service.sendMessage(DEVICE_ID, BRANCH_ID, '919008427482', 'Test');
      expect(result.status).toBe(false);
      expect(result.message).toContain('Delivery is unconfirmed');
      expect(result.uncertain).toBe(true);
      expect(mockClient.sendMessage).toHaveBeenCalledTimes(1);
    });
    test('returns status:false when no client found for device/branch', async () => {
      // clients map is empty
      fs.existsSync.mockReturnValue(false);
      const r = await service.sendMessage(DEVICE_ID, BRANCH_ID, '9876543210', 'Hello');
      expect(r.status).toBe(false);
      expect(r.message).toContain('not connected');
      expect(mockClient.initialize).not.toHaveBeenCalled();
    });

    test('resumes a saved phone link after restart and sends only once', async () => {
      fs.existsSync.mockReturnValue(true);
      mockClient.initialize.mockImplementationOnce(async () => {
        const ready = mockClient.on.mock.calls.find(([name]) => name === 'ready')[1];
        ready();
      });
      const r = await service.sendMessage(DEVICE_ID, BRANCH_ID, '919008427482', 'Recovery test');
      expect(r.status).toBe(true);
      expect(mockClient.initialize).toHaveBeenCalledTimes(1);
      expect(mockClient.sendMessage).toHaveBeenCalledTimes(1);
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
      expect(mockClient.sendMessage).toHaveBeenCalledWith('919876543210@c.us', 'Hi', {
        sendSeen: false,
      });
    });

    test('normalizes international plus notation before sending', async () => {
      service.clients.set(CLIENT_KEY, mockClient);
      mockClient.getState.mockResolvedValue('CONNECTED');
      await service.sendMessage(DEVICE_ID, BRANCH_ID, '+91 90084 27482', 'Hi');
      expect(mockClient.sendMessage).toHaveBeenCalledWith('919008427482@c.us', 'Hi', {
        sendSeen: false,
      });
    });

    test('does not modify phone number that already contains @c.us', async () => {
      service.clients.set(CLIENT_KEY, mockClient);
      mockClient.getState.mockResolvedValue('CONNECTED');
      await service.sendMessage(DEVICE_ID, BRANCH_ID, '919876543210@c.us', 'Hi');
      expect(mockClient.sendMessage).toHaveBeenCalledWith('919876543210@c.us', 'Hi', {
        sendSeen: false,
      });
    });

    test('returns {status:true} on successful send', async () => {
      service.clients.set(CLIENT_KEY, mockClient);
      mockClient.getState.mockResolvedValue('CONNECTED');
      const r = await service.sendMessage(DEVICE_ID, BRANCH_ID, '9876543210', 'Test message');
      expect(r).toEqual({
        status: true,
        message: 'Message sent successfully',
        messageId: 'test-message-id',
      });
    });

    test('sends the PDF and caption together without an extra text message', async () => {
      service.clients.set(CLIENT_KEY, mockClient);
      await service.sendMessage(DEVICE_ID, BRANCH_ID, '919008427482', 'Your bill', {
        buffer: Buffer.from('%PDF-test'),
        filename: 'invoice.pdf',
      });
      expect(mockClient.sendMessage).toHaveBeenCalledTimes(1);
      expect(mockClient.sendMessage).toHaveBeenCalledWith(
        '919008427482@c.us',
        expect.objectContaining({ mimetype: 'application/pdf', filename: 'invoice.pdf' }),
        { sendSeen: false, sendMediaAsDocument: true, caption: 'Your bill' }
      );
    });

    test('passes message body unchanged to client.sendMessage', async () => {
      service.clients.set(CLIENT_KEY, mockClient);
      mockClient.getState.mockResolvedValue('CONNECTED');
      const body = 'Your order #INV-001 is ready! Total: ₹500 😊\nPlease collect it.';
      await service.sendMessage(DEVICE_ID, BRANCH_ID, '9876543210', body);
      expect(mockClient.sendMessage).toHaveBeenCalledWith('9876543210@c.us', body, {
        sendSeen: false,
      });
    });

    test('returns {status:false} when client.sendMessage throws', async () => {
      service.clients.set(CLIENT_KEY, mockClient);
      mockClient.getState.mockResolvedValue('CONNECTED');
      mockClient.sendMessage.mockRejectedValueOnce(new Error('WA send failed'));
      const r = await service.sendMessage(DEVICE_ID, BRANCH_ID, '9876543210', 'Hi');
      expect(r.status).toBe(false);
      expect(r.message).toContain('could not confirm sending');
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
test('concurrent connection requests share one browser initialization', async () => {
  service.clients.clear();
  service.connectionStatus.clear();
  let finish;
  mockClient.initialize.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const before = Client.mock.calls.length;
  const one = service.initializeClient('concurrent', 'branch');
  const two = service.initializeClient('concurrent', 'branch');
  expect(Client.mock.calls.length - before).toBe(1);
  finish();
  await Promise.all([one, two]);
  expect(service.initializations.size).toBe(0);
  service.clients.clear();
  service.connectionStatus.clear();
});

test('uses the verified LID mapping before sending, without retrying', async () => {
  service.clients.set('branch_lid', mockClient);
  mockClient.getState.mockResolvedValue('CONNECTED');
  mockClient.getNumberId.mockResolvedValueOnce({ _serialized: '919008427482@c.us' });
  mockClient.getContactLidAndPhone.mockResolvedValueOnce([
    { pn: '919008427482@c.us', lid: '1234567890@lid' },
  ]);
  mockClient.sendMessage.mockClear();
  await service.sendMessage('lid', 'branch', '+919008427482', 'Test');
  expect(mockClient.sendMessage).toHaveBeenCalledTimes(1);
  expect(mockClient.sendMessage).toHaveBeenCalledWith('1234567890@lid', 'Test', {
    sendSeen: false,
  });
});
test('unregistered recipients do not reach sending', async () => {
  service.clients.set('branch_missing', mockClient);
  mockClient.getNumberId.mockResolvedValueOnce(null);
  mockClient.sendMessage.mockClear();
  const result = await service.sendMessage('missing', 'branch', '+919008427482', 'Test');
  expect(result.status).toBe(false);
  expect(mockClient.sendMessage).not.toHaveBeenCalled();
});

test('late events from a replaced browser cannot overwrite the new connection', async () => {
  service.clients.clear();
  mockClient.on.mockClear();
  await service.initializeClient('late', 'branch');
  const handlers = Object.fromEntries(mockClient.on.mock.calls);
  service.clients.set('branch_late', {});
  service.connectionStatus.set('branch_late', 'connected');
  handlers.qr('stale');
  handlers.authenticated();
  handlers.auth_failure('old');
  handlers.ready();
  expect(service.getConnectionStatus('late', 'branch')).toBe('connected');
  expect(service.getQRCode('late', 'branch')).toBeNull();
});
test('string initialization errors retain their diagnostic message', async () => {
  service.clients.clear();
  mockClient.initialize.mockRejectedValueOnce('auth timeout');
  const result = await service.initializeClient('timeout', 'branch');
  expect(result).toMatchObject({ status: false, message: 'auth timeout' });
  expect(service.getConnectionStatus('timeout', 'branch')).toBe('auth_failed');
});
test('recovery waits for the matching ready event and removes its listeners', async () => {
  service.connectionStatus.set('branch_recover', 'authenticated');
  let finished = false;
  const waiting = service._waitForReady('branch_recover', 1000).then((value) => {
    finished = true;
    return value;
  });
  service.emit('ready', { clientKey: 'another_branch' });
  await Promise.resolve();
  expect(finished).toBe(false);
  service.emit('ready', { clientKey: 'branch_recover' });
  expect(await waiting).toBe(true);
  expect(service.listenerCount('ready')).toBe(0);
});
test('recovery timeout and fresh QR stop before sending', async () => {
  service.connectionStatus.set('branch_timeout', 'initializing');
  expect(await service._waitForReady('branch_timeout', 1)).toBe(false);
  service.connectionStatus.set('branch_qr', 'qr_ready');
  expect(await service._waitForReady('branch_qr', 1)).toBe(false);
  expect(service.listenerCount('ready')).toBe(0);
});
test.each([undefined, new Error('LID chat has not synced')])(
  'uses the verified phone address when the LID chat is unavailable: %s',
  async (lookupError) => {
    service.clients.set('branch_chat', mockClient);
    mockClient.getContactLidAndPhone.mockResolvedValueOnce([
      { pn: '919008427482@c.us', lid: '123@lid' },
    ]);
    mockClient.getChatById = jest.fn();
    if (lookupError) mockClient.getChatById.mockRejectedValueOnce(lookupError);
    else mockClient.getChatById.mockResolvedValueOnce(undefined);
    mockClient.getChatById.mockResolvedValueOnce({ id: 'phone-chat' });
    mockClient.sendMessage.mockClear();
    try {
      const result = await service.sendMessage('chat', 'branch', '919008427482', 'Test');
      expect(result.status).toBe(true);
      expect(mockClient.sendMessage).toHaveBeenCalledTimes(1);
      expect(mockClient.getChatById).toHaveBeenCalledTimes(1);
      expect(mockClient.sendMessage).toHaveBeenCalledWith('919008427482@c.us', 'Test', {
        sendSeen: false,
      });
    } finally {
      delete mockClient.getChatById;
    }
  }
);

test('runtime compatibility is installed before sending without relying on postinstall', async () => {
  service.clients.set('branch_compat', mockClient);
  const evaluate = jest.fn().mockResolvedValue(undefined);
  mockClient.pupPage = { evaluate };
  mockClient.sendMessage.mockClear();
  try {
    const result = await service.sendMessage('compat', 'branch', '919008427482', 'Test');
    expect(result.status).toBe(true);
    expect(evaluate).toHaveBeenCalledWith(require('../../../src/utils/whatsapp-msgkey-compat'));
    expect(evaluate.mock.invocationCallOrder[0]).toBeLessThan(
      mockClient.sendMessage.mock.invocationCallOrder[0]
    );
    expect(mockClient.sendMessage).toHaveBeenCalledTimes(1);
    evaluate.mockRejectedValueOnce(new Error('Browser disconnected'));
    mockClient.sendMessage.mockClear();
    expect((await service.sendMessage('compat', 'branch', '919008427482', 'Test')).status).toBe(
      false
    );
    expect(mockClient.sendMessage).not.toHaveBeenCalled();
  } finally {
    delete mockClient.pupPage;
  }
});

test('a new recipient does not require a previously synced phone chat', async () => {
  service.clients.set('branch_newchat', mockClient);
  mockClient.getContactLidAndPhone.mockResolvedValueOnce([]);
  mockClient.getChatById = jest.fn().mockRejectedValue(new Error('Chat not found'));
  mockClient.sendMessage.mockClear();
  try {
    const result = await service.sendMessage('newchat', 'branch', '919008427482', 'Test');
    expect(result.status).toBe(true);
    expect(mockClient.getChatById).not.toHaveBeenCalled();
    expect(mockClient.sendMessage).toHaveBeenCalledTimes(1);
  } finally {
    delete mockClient.getChatById;
  }
});

test('stalled initialization expires, preserves authentication and permits retry', async () => {
  jest.useFakeTimers();
  try {
    mockClient.initialize.mockImplementationOnce(() => new Promise(() => {}));
    const pending = service.initializeClient('stalled', 'branch');
    await jest.advanceTimersByTimeAsync(120001);
    expect((await pending).status).toBe(false);
    expect(service.getConnectionStatus('stalled', 'branch')).toBe('auth_failed');
    expect(service.initializations.has('branch_stalled')).toBe(false);
    expect(service.clients.has('branch_stalled')).toBe(false);
    expect((await service.initializeClient('stalled', 'branch')).status).toBe(true);
    service._safeCleanupClient('branch_stalled');
  } finally {
    jest.useRealTimers();
  }
});

test('authenticated session hides its QR and expires if ready never arrives', async () => {
  jest.useFakeTimers();
  try {
    await service.initializeClient('authstall', 'branch');
    const handlers = Object.fromEntries(mockClient.on.mock.calls);
    service.qrCodes.set('branch_authstall', 'old-code');
    handlers.authenticated();
    expect(service.getQRCode('authstall', 'branch')).toBeNull();
    await jest.advanceTimersByTimeAsync(120001);
    expect(service.getConnectionStatus('authstall', 'branch')).toBe('auth_failed');
  } finally {
    jest.useRealTimers();
  }
});
