const path = require('path');
const { app: electronApp } = require('electron');
const fs = require('fs');
const Module = require('module');

// Add api node_modules to module paths BEFORE requiring setup-mongodb
// This allows setup-mongodb.js to find 'mongodb' package
const initialApiPath = electronApp.isPackaged 
  ? path.join(process.resourcesPath, 'api')
  : path.join(__dirname, 'api');
let apiNodeModules = path.join(initialApiPath, 'node_modules');

if (!module.paths.includes(apiNodeModules)) {
  module.paths.unshift(apiNodeModules);
}
if (!module.paths.includes(initialApiPath)) {
  module.paths.unshift(initialApiPath);
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
    apiPath = path.join(__dirname, 'api');
  }
  
  console.log('API Path:', apiPath);
  console.log('API Path exists:', fs.existsSync(apiPath));
  
  if (!fs.existsSync(apiPath)) {
    console.error('ERROR: api path does not exist!');
    console.error('Trying alternative paths...');
    
    // Try alternative paths
    const alternatives = [
      path.join(__dirname, 'api'),
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
            // Block removed/disconnected devices (skip OPTIONS preflight)
            if (req.method !== 'OPTIONS' && t.blockedIPs && t.blockedIPs.has(ip)) {
              const origin = req.headers['origin'] || '*';
              res.writeHead(401, {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': origin,
                'Access-Control-Allow-Credentials': 'true',
              });
              res.end(JSON.stringify({ status: 'error', code: 'DEVICE_BLOCKED', message: 'Your device has been blocked by the administrator. Please contact your admin to restore access.' }));
              return;
            }
            if (!t.devices[ip] && req.method !== 'OPTIONS') {
              // Enforce max device limit (OPTIONS preflights are skipped — they must not register devices)
              const MAX_DEVICES = t.maxDevices || 6;
              const activeCount = Object.keys(t.devices).length; // blocked devices are evicted from t.devices on block
              if (activeCount >= MAX_DEVICES) {
                const origin = req.headers['origin'] || '*';
                res.writeHead(403, {
                  'Content-Type': 'application/json',
                  'Access-Control-Allow-Origin': origin,
                  'Access-Control-Allow-Credentials': 'true',
                });
                res.end(JSON.stringify({ status: 'error', code: 'DEVICE_LIMIT_REACHED', message: 'Maximum device limit reached. Please contact your administrator.' }));
                return;
              }
              t.devices[ip] = { ip, ua, firstSeen: new Date().toISOString(), lastSeen: new Date().toISOString(), requests: 0 };
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
