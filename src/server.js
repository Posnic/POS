const path = require('path');
const { app: electronApp } = require('electron');
const fs = require('fs');
const Module = require('module');

// Add api node_modules to module paths BEFORE requiring setup-mongodb
// This allows setup-mongodb.js to find 'mongodb' package
const initialApiPath = electronApp.isPackaged 
  ? path.join(process.resourcesPath, 'api')
  : path.join(__dirname, '..', 'api');
let apiNodeModules = path.join(initialApiPath, 'node_modules');

if (!module.paths.includes(apiNodeModules)) {
  module.paths.unshift(apiNodeModules);
}
if (!module.paths.includes(initialApiPath)) {
  module.paths.unshift(initialApiPath);
}

/*
 * WHO ANSWERS A HANDSET WHEN THE THING THAT DECIDES IS MISSING.
 *
 * This require used to sit INSIDE the per-request path, and that turned a
 * missing file into the worst failure this server has. The decision runs
 * inside an override of server.emit, so a throw there does not become a 500 -
 * it escapes as an uncaught exception and THE REQUEST IS NEVER ANSWERED. The
 * handset sits on an open socket until it times out, the till looks perfectly
 * healthy, and the shop is told the captain app keeps disconnecting. Which is
 * the same sentence this whole area exists because of.
 *
 * It happened. A build reached a shop with server.js asking for
 * ./handset-slots and the file not beside it, and every LAN request hung while
 * localhost stayed instant - because the guard below only consults the slots
 * for non-loopback callers.
 *
 * So it is required ONCE, here, where a failure is one line in the log at
 * startup rather than an invisible hang per request.
 *
 * AND IT FAILS OPEN. The cap is there so a shop is not silently serving a
 * stranger's phone, which is worth having and is not a security boundary - the
 * API's own authentication is. Weighed against a till that stops answering its
 * handsets mid-service, an uncapped device list is the smaller harm by a long
 * way. This module's own history says the same thing: every outage it
 * documents came from refusing a handset that should have been served.
 */
let handsetSlots = null;
try {
  handsetSlots = require('./handset-slots');
} catch (err) {
  console.error(
    '[handset] src/handset-slots.js is missing or will not load, so every handset on the ' +
      'network will be admitted and the device cap is not being applied:',
    err && err.message
  );
}

/* Said once. A till serving a busy floor would otherwise write this line
   several times a second and bury everything else in the log. */
let saidSlotsWereBroken = false;
function slotsAreBroken(err) {
  if (saidSlotsWereBroken) return;
  saidSlotsWereBroken = true;
  console.error(
    '[handset] the device cap is not being applied, so every handset is being admitted:',
    (err && err.message) || 'handset-slots did not answer'
  );
}

/**
 * Whether to serve this LAN request. NEVER THROWS, and never returns nothing.
 *
 * Lifted out as its own function so the thing that must not throw can actually
 * be tested - the caller is an emit override, which cannot be.
 *
 * @param {object|null} slots  the handset-slots module, or null if it is gone
 * @param {object} ask  what admit() is asked
 * @param {function} onBroken  told once when the decision could not be made
 * @returns {{allow: boolean, code?: string, message?: string, register?: boolean}}
 */
function admitHandset(slots, ask, onBroken) {
  if (!slots || typeof slots.admit !== 'function') {
    if (onBroken) onBroken(null);
    return { allow: true, register: true };
  }
  try {
    const verdict = slots.admit(ask);
    if (verdict && typeof verdict.allow === 'boolean') return verdict;
    if (onBroken) onBroken(null);
    return { allow: true, register: true };
  } catch (err) {
    if (onBroken) onBroken(err);
    return { allow: true, register: true };
  }
}

module.exports = async function startServer(options = {}) {
  const reportProgress = typeof options.onProgress === 'function'
    ? options.onProgress
    : () => {};

  if (electronApp.isPackaged) {
    reportProgress({
      stage: 'api',
      text: 'Preparing API runtime...',
      details: 'One-time setup after install or update',
      progress: 50
    });
    const { ensureApiRuntime } = require(path.join(process.resourcesPath, 'api-runtime.js'));
    apiNodeModules = await ensureApiRuntime({
      archivePath: path.join(initialApiPath, 'node_modules.zip'),
      /*
       * The 7-Zip for this machine, not for the machine it was built on.
       *
       * This said '7za.exe' unconditionally, and extraResources copied
       * node_modules/7zip-bin/win/x64/7za.exe into every build - so the Linux
       * and macOS packages shipped a Windows executable and then tried to run
       * it. The first launch after install failed while extracting the API
       * runtime, naming 7za.exe on a machine that has no .exe files at all.
       *
       * 7zip-bin carries a binary per platform and architecture; the build now
       * takes the matching one and lands it here under a plain name.
       */
      sevenZipPath: path.join(
        process.resourcesPath,
        'tools',
        process.platform === 'win32' ? '7za.exe' : '7za',
      ),
      userDataPath: electronApp.getPath('userData'),
      onProgress: (percent) => reportProgress({
        stage: 'api',
        text: 'Extracting application runtime...',
        details: `One-time setup after install or update - ${percent}%`,
        progress: 50 + Math.round(percent * 0.08)
      })
    });
    const nodePaths = (process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean);
    if (!nodePaths.includes(apiNodeModules)) {
      process.env.NODE_PATH = [apiNodeModules, ...nodePaths].join(path.delimiter);
    }
    // Always re-derive Module.globalPaths from NODE_PATH, even if the env var
    // already contained apiNodeModules. After app.relaunch(), the new process
    // inherits NODE_PATH from the old one, so the check above is a no-op -
    // but Module.globalPaths itself is per-process and starts empty; without
    // this call 'mongodb' resolves fine on a fresh launch but throws
    // MODULE_NOT_FOUND on every relaunch/restart.
    Module._initPaths();
    if (!module.paths.includes(apiNodeModules)) module.paths.unshift(apiNodeModules);
  }

  const { setupMongoDB } = require('./setup-mongodb');
  console.log('='.repeat(60));
  console.log('Starting api server in-process...');
  console.log('='.repeat(60));
  
  // Run MongoDB setup check
  const setupResult = await setupMongoDB();
  if (!setupResult.success) {
    console.error('❌ MongoDB setup failed. Please install MongoDB and try again.');
    return { success: false, needsWizard: false };
  }
  
  // Resolve a MongoDB URI that actually works before starting the API server.
  const workingMongoUri = setupResult.mongoUri || process.env.MONGODB_URI;
  if (!workingMongoUri) {
    console.error('❌ No working MongoDB connection could be established.');
    console.error('   Check the credentials file or start MongoDB without auth.');
    return { success: false, needsWizard: false };
  }
  process.env.MONGODB_URI = workingMongoUri;
  console.log('🔐 Using validated MongoDB connection');
  
  process.env.NODE_ENV = process.env.NODE_ENV || 'development';
  process.env.PORT = process.env.PORT || '5555';
  
  // Note: We need to start the API server even if wizard is needed
  // because the wizard makes API calls to create the first user
  const needsWizard = setupResult.needsWizard;
  if (needsWizard) {
    console.log('📋 Installation wizard required - starting API server for wizard');
  }
  
  console.log('Environment:');
  console.log('  - isPackaged:', electronApp.isPackaged);
  console.log('  - __dirname:', __dirname);
  console.log('  - process.resourcesPath:', process.resourcesPath);
  
  // Determine the correct path for api
  let apiPath;
  if (electronApp.isPackaged) {
    // In packaged app, api is in extraResources
    apiPath = path.join(process.resourcesPath, 'api');
  } else {
    // In development, use __dirname
    apiPath = path.join(__dirname, '..', 'api');
  }
  
  console.log('API Path:', apiPath);
  console.log('API Path exists:', fs.existsSync(apiPath));
  
  if (!fs.existsSync(apiPath)) {
    console.error('ERROR: api path does not exist!');
    console.error('Trying alternative paths...');
    
    // Try alternative paths
    const alternatives = [
      path.join(__dirname, '..', 'api'),
      path.join(process.resourcesPath, 'api'),
      path.join(process.resourcesPath, 'app', 'api')
    ];
    
    for (const altPath of alternatives) {
      console.log(`Checking: ${altPath} - exists: ${fs.existsSync(altPath)}`);
      if (fs.existsSync(altPath)) {
        apiPath = altPath;
        console.log(`Using alternative path: ${apiPath}`);
        break;
      }
    }
  }
  
  const serverJsPath = path.join(apiPath, 'server.js');
  console.log('server.js path:', serverJsPath);
  console.log('server.js exists:', fs.existsSync(serverJsPath));
  
  if (!fs.existsSync(serverJsPath)) {
    const error = new Error(`api/server.js not found at: ${serverJsPath}`);
    console.error('FATAL ERROR:', error.message);
    throw error;
  }
  
  try {
    const apiModulesStartedAt = Date.now();
    reportProgress({
      stage: 'api',
      text: 'Starting POS services...',
      details: 'Loading billing, inventory and reporting modules - first run takes a little longer',
      progress: 62
    });
    console.log('Loading api in-process...');
    
    // Add api and its node_modules to module paths FIRST
    if (!module.paths.includes(apiPath)) {
      module.paths.unshift(apiPath);
    }
    if (!module.paths.includes(apiNodeModules)) {
      module.paths.unshift(apiNodeModules);
    }
    console.log('Added to module paths:', apiPath);
    
    // Change to api directory
    const originalCwd = process.cwd();
    process.chdir(apiPath);
    console.log('Changed directory to:', process.cwd());
    
    // Load dotenv from api's node_modules (with fallback)
    try {
      const dotenvPath = path.join(apiNodeModules, 'dotenv');
      if (fs.existsSync(dotenvPath)) {
        const dotenv = require(dotenvPath);
        dotenv.config({ path: path.join(apiPath, '.env'), quiet: true });
        console.log('✅ dotenv loaded from api');
      } else {
        // Try installer's node_modules
        try {
          require('dotenv').config({ path: path.join(apiPath, '.env') });
          console.log('✅ dotenv loaded from installer');
        } catch (e) {
          console.warn('⚠️ dotenv not available, skipping .env loading');
        }
      }
    } catch (envErr) {
      console.warn('⚠️ Failed to load dotenv:', envErr.message);
    }
    
    // Override environment variables
    if (!process.env.MONGODB_URI) {
        process.env.MONGODB_URI = `mongodb://localhost:${process.env.POSNIC_MONGO_PORT || 47017}/PosnicPro`;
    }
    process.env.PORT = process.env.PORT || '5555';
    process.env.NODE_ENV = 'development';
    
    console.log('Environment configured:');
    console.log('  - MONGODB_URI:', process.env.MONGODB_URI);
    console.log('  - PORT:', process.env.PORT);
    
    // Load mongoose and app from api's node_modules
    const mongoose = require(path.join(apiNodeModules, 'mongoose'));
    const app = require(path.join(apiPath, 'app.js'));
    reportProgress({
      stage: 'timing',
      details: {
        name: 'apiModulesLoaded',
        durationMs: Date.now() - apiModulesStartedAt
      }
    });
    
    console.log('Connecting to MongoDB...');
    reportProgress({
      stage: 'api',
      text: 'Connecting to database...',
      details: 'Opening secure local connection',
      progress: 78
    });
    
    // These clients are independent, so avoid two sequential handshakes.
    const { MongoClient } = require(path.join(apiNodeModules, 'mongodb'));
    const mongoClient = new MongoClient(process.env.MONGODB_URI);
    const databaseConnectStartedAt = Date.now();
    await Promise.all([
      mongoose.connect(process.env.MONGODB_URI),
      mongoClient.connect()
    ]);
    reportProgress({
      stage: 'timing',
      details: {
        name: 'databaseConnected',
        durationMs: Date.now() - databaseConnectStartedAt
      }
    });
    console.log('✅ MongoDB Connected Successfully!');
    console.log(`📊 Database: ${mongoose.connection.name}`);
    
    // Add mongoClient to app.locals for session filter utility
    app.locals.mongoClient = mongoClient;
    console.log("✅ MongoDB Client added to app.locals for session management");

    reportProgress({ stage: 'database-health', text: 'Checking database health...', details: 'Validating indexes and settings', progress: 84 });
    const { runDatabaseHealthCheck } = require('./database-health');
    const databaseHealth = await runDatabaseHealthCheck(mongoClient);
    console.log(`[Database Health] ${databaseHealth.status.toUpperCase()} in ${databaseHealth.durationMs}ms`);
    databaseHealth.warnings.forEach((warning) => console.warn(`[Database Health] ${warning}`));
    databaseHealth.errors.forEach((error) => console.error(`[Database Health] ${error}`));
    reportProgress({
      stage: 'database-health-result',
      text: databaseHealth.status === 'healthy' ? 'Database healthy' : 'Database needs attention',
      details: databaseHealth,
      progress: 88,
    });
    
    // Start Express server
    const PORT = process.env.PORT || 5555;
    const server = app.listen(PORT);
    const serverReady = new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    // Track mobile device requests via http.Server event interception
    const _origEmit = server.emit.bind(server);
    server.emit = function(event, req, res, ...rest) {
      if (event === 'request' && req && res) {
        const requestStartedAt = Date.now();
        const responseChunks = [];
        let capturedResponseBytes = 0;
        const MAX_CAPTURE_BYTES = 16 * 1024;
        const originalWrite = res.write.bind(res);
        const originalEnd = res.end.bind(res);

        const captureChunk = (chunk, encoding) => {
          if (chunk == null || capturedResponseBytes >= MAX_CAPTURE_BYTES) return;
          try {
            const buffer = Buffer.isBuffer(chunk)
              ? chunk
              : Buffer.from(String(chunk), encoding || 'utf8');
            const remaining = MAX_CAPTURE_BYTES - capturedResponseBytes;
            const captured = buffer.subarray(0, remaining);
            responseChunks.push(captured);
            capturedResponseBytes += captured.length;
          } catch (_) {}
        };

        res.write = function(chunk, encoding, callback) {
          captureChunk(chunk, encoding);
          return originalWrite(chunk, encoding, callback);
        };

        res.end = function(chunk, encoding, callback) {
          captureChunk(chunk, encoding);
          return originalEnd(chunk, encoding, callback);
        };

        res.once('finish', () => {
          if (res.statusCode < 400) return;

          const rawUrl = req.originalUrl || req.url || '/';
          let safePath = rawUrl;
          try {
            const parsedUrl = new URL(rawUrl, `http://localhost:${PORT}`);
            const secretParams = [
              'token', 'jwt', 'password', 'secret', 'key',
              'authorization', 'access_token', 'refresh_token'
            ];
            for (const name of secretParams) {
              if (parsedUrl.searchParams.has(name)) {
                parsedUrl.searchParams.set(name, '[REDACTED]');
              }
            }
            safePath = `${parsedUrl.pathname}${parsedUrl.search}`;
          } catch (_) {}

          let responseMessage = '';
          const responseText = Buffer.concat(responseChunks).toString('utf8').trim();
          if (responseText) {
            try {
              const parsedBody = JSON.parse(responseText);
              responseMessage =
                parsedBody.message ||
                parsedBody.error?.message ||
                (typeof parsedBody.error === 'string' ? parsedBody.error : '') ||
                parsedBody.status ||
                '';
            } catch (_) {
              // Never copy arbitrary HTML/text response bodies into logs.
              responseMessage = res.statusMessage || 'Non-JSON error response';
            }
          }

          const diagnostic = {
            method: req.method,
            path: safePath,
            status: res.statusCode,
            durationMs: Date.now() - requestStartedAt,
            userLoggedIn: Boolean(
              req.user ||
              req.session?.userId ||
              req.session?.selectedBranchId
            ),
            authorizationHeaderPresent: Boolean(req.headers.authorization),
            jwtCookiePresent: /(?:^|;\s*)jwt=/.test(req.headers.cookie || ''),
            sessionCookiePresent: /(?:^|;\s*)connect\.sid=/.test(req.headers.cookie || ''),
            response: String(responseMessage || 'No response message').slice(0, 500)
          };

          const logMethod = res.statusCode >= 500 ? console.error : console.warn;
          logMethod('[Request Failure]', diagnostic);
        });

        const rawIp = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '';
        const ip = rawIp.replace(/^::ffff:/, '');
        if (ip && ip !== '127.0.0.1' && ip !== '::1') {
          console.log(`[MobileTracker] External request: ${ip} → ${req.method} ${req.url}`);
        }
        if (ip && ip !== '127.0.0.1' && ip !== '::1') {
          const ua = req.headers['user-agent'] || 'Unknown';
          const t = global.mobileTracker;
          if (t) {
            /*
             * WHETHER THIS REQUEST IS SERVED, decided in handset-slots.js.
             *
             * Pure and out there because it is the part worth testing, and it
             * cannot be tested inside an emit override. It also carries the
             * whole account of why a shop saw "captain app keep disconnected":
             * slots keyed by IP, never expiring, and the health check being
             * refused once they filled.
             *
             * The module is required at the top of this file, not here. A
             * require in this position is evaluated per request, and a failure
             * in this position is never answered at all - see the comment
             * beside it.
             */
            const verdict = admitHandset(
              handsetSlots,
              {
                devices: t.devices,
                blocked: t.blockedIPs,
                ip,
                method: req.method,
                url: req.url,
                maxDevices: t.maxDevices,
              },
              slotsAreBroken
            );

            if (!verdict.allow) {
              const origin = req.headers['origin'] || '*';
              res.writeHead(verdict.code === 'DEVICE_BLOCKED' ? 401 : 403, {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': origin,
                'Access-Control-Allow-Credentials': 'true',
              });
              res.end(
                JSON.stringify({ status: 'error', code: verdict.code, message: verdict.message })
              );
              return;
            }

            if (verdict.register && !t.devices[ip]) {
              t.devices[ip] = {
                ip,
                ua,
                firstSeen: new Date().toISOString(),
                lastSeen: new Date().toISOString(),
                requests: 0,
              };
            }

            if (t.devices[ip]) {
              t.devices[ip].lastSeen = new Date().toISOString();
              t.devices[ip].requests++;
            }
            if (req.method === 'POST' && /login|signin|auth/i.test(req.url)) {
              res.on('finish', () => {
                t.loginLogs.unshift({ ip, ua, time: new Date().toISOString(), path: req.url, success: res.statusCode < 300, statusCode: res.statusCode });
                if (t.loginLogs.length > 200) t.loginLogs.length = 200;
                // Unblock IP on successful login
                if (res.statusCode < 300 && t.blockedIPs) {
                  t.blockedIPs.delete(ip);
                }
              });
            }
          }
        }
      }
      return _origEmit(event, req, res, ...rest);
    };

    // Store server reference for cleanup
    global.apiServer = server;
    global.mongooseConnection = mongoose.connection;

    // Do not redirect the Electron window until Express accepts requests.
    await serverReady;
    reportProgress({
      stage: 'ready',
      text: 'Loading Interface...',
      details: 'Opening login screen',
      progress: 95
    });
    console.log('🚀 =====================================');
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`🚀 API Endpoint: http://localhost:${PORT}/api`);
    console.log('🚀 =====================================');
    
    // Change back to original directory
    process.chdir(originalCwd);
    
    return { success: true, needsWizard: needsWizard, databaseHealth };
  } catch (error) {
    console.error('='.repeat(60));
    console.error('FATAL ERROR starting api server:');
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    console.error('='.repeat(60));
    throw error;
  }
};
