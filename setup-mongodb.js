// Dynamically require mongodb from api node_modules
let MongoClient, ObjectId;
try {
  const { app: electronApp } = require('electron');
  const path = require('path');
  
  // Determine api path
  const apiPath = electronApp && electronApp.isPackaged
    ? path.join(process.resourcesPath, 'api')
    : path.join(__dirname, 'api');
  
  const mongodbPath = path.join(apiPath, 'node_modules', 'mongodb');
  const mongodb = require(mongodbPath);
  MongoClient = mongodb.MongoClient;
  ObjectId = mongodb.ObjectId;
} catch (e) {
  // Fallback to regular require (for dev mode)
  const mongodb = require('mongodb');
  MongoClient = mongodb.MongoClient;
  ObjectId = mongodb.ObjectId;
}
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

async function isAdmin() {
  try {
    // 'net session' command only works if user has admin privileges
    execSync('net session', { stdio: 'ignore' });
    return true;
  } catch (error) {
    return false;
  }
}

// Get writable base path (userData in packaged app, __dirname in dev)
function getWritableBasePath() {
  try {
    const { app } = require('electron');
    if (app && app.isPackaged) {
      return app.getPath('userData');
    }
  } catch (e) {
    // Electron not available
  }
  return __dirname;
}

/*
 * Load credentials, whichever shape they are in.
 *
 * credentials-store reads both the encrypted form and the plain one an older
 * install left behind, and rebuilds the connection string from the parts so the
 * password never has to be stored inside a uri. If it cannot decrypt - a key
 * file lost with a Windows profile, or a folder copied from another machine -
 * that is reported rather than swallowed, because the answer is to recreate the
 * database user, not to carry on without a password.
 */
function loadCredentials() {
  const writableBase = getWritableBasePath();
  const credentialsPaths = [
    path.join(writableBase, '.mongodb-credentials.json'),
    path.join(__dirname, '.mongodb-credentials.json'),
    path.join(__dirname, 'api', '.mongodb-credentials.json'),
  ];

  let store;
  try {
    store = require('./credentials-store');
  } catch (e) {
    console.warn('⚠️ credentials-store unavailable, reading credentials directly:', e.message);
    store = null;
  }

  if (store) {
    try {
      const creds = store.read(credentialsPaths, writableBase);
      if (creds && creds.uri) {
        /*
         * Migrate in place, on the first start after updating.
         *
         * Every existing shop has this file in plain text, and nothing else
         * would ever rewrite it - the only other writer runs during
         * installation, which has already happened. Without this the
         * encryption would apply to new installs only and every till already
         * in a shop would keep its password readable for ever.
         *
         * It writes back exactly what was just read, so a failure here costs
         * nothing: the plain file is still there and still works, and the next
         * start tries again.
         */
        if (creds.wasPlaintext) {
          try {
            const written = store.write([creds.path], creds, writableBase);
            console.log(
              written.length
                ? `🔐 MongoDB credentials encrypted in place: ${creds.path}`
                : '⚠️ Could not encrypt stored credentials; continuing with the existing file'
            );
          } catch (migrateErr) {
            console.warn('⚠️ Could not encrypt stored credentials:', migrateErr.message);
          }
        } else {
          console.log('🔐 Loaded MongoDB credentials from:', creds.path);
        }
        return creds.uri;
      }
      if (creds) return null;
    } catch (e) {
      /* Distinguishable on purpose: the caller can rotate rather than guess. */
      console.warn('⚠️ Stored MongoDB credentials could not be decrypted:', e.message);
      return null;
    }
  }

  /* Only reached if the store itself could not be loaded. */
  for (const credPath of credentialsPaths) {
    if (fs.existsSync(credPath)) {
      try {
        const creds = JSON.parse(fs.readFileSync(credPath, 'utf8'));
        if (typeof creds.uri === 'string' && creds.uri.includes('@')) {
          console.log('🔐 Loaded MongoDB credentials from:', credPath);
          return creds.uri;
        }
      } catch (e) {
        console.warn('⚠️ Error reading credentials file:', credPath, e.message);
      }
    }
  }
  return null;
}

// Use credentials if available, otherwise default local URI
const MONGODB_URI = loadCredentials() || process.env.MONGODB_URI || `mongodb://localhost:${process.env.POSNIC_MONGO_PORT || 47017}`;
const DB_NAME = 'PosnicPro';
const SETUP_FLAG_FILE = path.join(getWritableBasePath(), '.mongodb-setup-done');

// Default installation data for first-time setup
async function checkServiceExists(serviceName) {
  try {
    const output = execSync(`sc query "${serviceName}"`, { encoding: 'utf8', stdio: 'pipe' });
    return output.includes('SERVICE_NAME');
  } catch (error) {
    return false;
  }
}

async function startMongoDBService() {
  try {
    console.log('🔄 Attempting to start MongoDB service...');
    
    // List of possible MongoDB service names
    const serviceNames = ['MongoDB', 'MongoDB Server', 'MongoDBServer'];
    
    for (const serviceName of serviceNames) {
      console.log(`   Checking service: ${serviceName}`);
      
      // Check if service exists
      const exists = await checkServiceExists(serviceName);
      if (!exists) {
        console.log(`   Service "${serviceName}" not found`);
        continue;
      }
      
      console.log(`   Found service: ${serviceName}`);
      
      try {
        // Try to start the service
        execSync(`net start "${serviceName}"`, { stdio: 'pipe' });
        console.log(`✅ MongoDB service "${serviceName}" started successfully`);
        
        // Wait longer for service to fully start and be ready
        console.log('   Waiting for MongoDB to be ready...');
        await new Promise(resolve => setTimeout(resolve, 5000));
        return true;
      } catch (startError) {
        const errorMsg = startError.message || '';
        
        // Service might already be running
        if (errorMsg.includes('already been started') || errorMsg.includes('already running')) {
          console.log(`✅ MongoDB service "${serviceName}" is already running`);
          await new Promise(resolve => setTimeout(resolve, 2000));
          return true;
        }
        
        console.log(`   Failed to start "${serviceName}": ${errorMsg}`);
      }
    }
    
    console.warn('⚠️  Could not start MongoDB service automatically');
    
    if (!(await isAdmin())) {
      console.error('\n❌ ERROR: Administrator privileges required to start system services.');
      console.error('👉 Please restart this application as Administrator (Right-click > Run as Administrator).\n');
    } else {
      console.warn('   MongoDB service not found on this system');
    }
    
    console.warn('   📥 To install MongoDB, run: install-mongodb.bat');
    return false;
  } catch (error) {
    if (error.message.includes('Access is denied')) {
        console.error('\n❌ ERROR: Access Denied. Please Run as Administrator to manage MongoDB service.\n');
    } else {
        console.error('❌ Failed to start MongoDB service:', error.message);
    }
    return false;
  }
}

async function checkMongoDBInstalled() {
  // Try with credentials first (if MongoDB has auth enabled)
  const credUri = loadCredentials();
  
  // Try various connection URIs
  const uris = [];
  if (credUri) uris.push(credUri);
  uris.push(MONGODB_URI);
  uris.push(`mongodb://localhost:${process.env.POSNIC_MONGO_PORT || 47017}/PosnicPro`);
  uris.push('mongodb://localhost:27017');
  
  for (const uri of uris) {
    try {
      const client = new MongoClient(uri, {
        serverSelectionTimeoutMS: 3000,
        connectTimeoutMS: 3000
      });
      await client.connect();
      console.log('✅ MongoDB is installed and running');
      await client.close();
      return true;
    } catch (e) {
      // If error indicates auth is required, MongoDB IS running
      if (e.message && (e.message.includes('Authentication failed') ||
                        e.message.includes('requires authentication') ||
                        e.message.includes('Unauthorized'))) {
        console.log('✅ MongoDB is running (auth required)');
        return true;
      }
    }
  }
  
  // All connection attempts failed - try service start as fallback
  try {
    const client = new MongoClient(MONGODB_URI, {
      serverSelectionTimeoutMS: 3000,
      connectTimeoutMS: 3000
    });
    
    await client.connect();
    console.log('✅ MongoDB is installed and running');
    await client.close();
    return true;
  } catch (error) {
    console.log('⚠️  MongoDB connection failed:', error.message);
    
    // MongoDB might be installed but service is not running
    // Try to start the service
    console.log('🔍 Checking if MongoDB service exists...');
    const serviceStarted = await startMongoDBService();
    
    if (serviceStarted) {
      // Try connecting multiple times after starting service
      console.log('🔄 Attempting to connect to MongoDB...');
      
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          console.log(`   Connection attempt ${attempt}/3...`);
          const client = new MongoClient(MONGODB_URI, {
            serverSelectionTimeoutMS: 8000,
            connectTimeoutMS: 8000
          });
          
          await client.connect();
          console.log('✅ MongoDB is now running and connected!');
          await client.close();
          return true;
        } catch (retryError) {
          if (attempt < 3) {
            console.log(`   Attempt ${attempt} failed, retrying...`);
            await new Promise(resolve => setTimeout(resolve, 3000));
          } else {
            console.error('❌ MongoDB service started but connection still failed after 3 attempts');
            console.error('Error:', retryError.message);
          }
        }
      }
      
      return false;
    }
    
    console.error('❌ MongoDB is not running or not installed');
    return false;
  }
}

/**
 * Try to connect to MongoDB and verify with a real read operation
 * Returns the working URI or null if all fail
 */
async function getWorkingMongoUri() {
  // Strategy 1: Try with credentials from file (if MongoDB is running with auth)
  const credUri = loadCredentials();
  if (credUri) {
    try {
      console.log('🔐 Trying authenticated connection...');
      const client = new MongoClient(credUri, {
        serverSelectionTimeoutMS: 3000,
        connectTimeoutMS: 3000
      });
      await client.connect();
      // Use listCollections instead of ping (avoids crypto issues)
      await client.db(DB_NAME).listCollections().toArray();
      await client.close();
      console.log('✅ Authenticated connection works');
      return credUri;
    } catch (err) {
      console.log('⚠️ Authenticated connection failed:', err.message);
    }
  }
  
  // Strategy 2: Try without authentication
  const unauthUri = `mongodb://localhost:${process.env.POSNIC_MONGO_PORT || 47017}/PosnicPro`;
  try {
    console.log('📡 Trying unauthenticated connection...');
    const client = new MongoClient(unauthUri, {
      serverSelectionTimeoutMS: 3000,
      connectTimeoutMS: 3000
    });
    await client.connect();
    // Use listCollections instead of ping (avoids crypto issues)
    await client.db(DB_NAME).listCollections().toArray();
    await client.close();
    console.log('✅ Unauthenticated connection works');
    return unauthUri;
  } catch (err) {
    console.log('⚠️ Unauthenticated connection failed:', err.message);
    // If unauth fails with auth error → MongoDB has auth enabled
    // and we don't have right credentials → still need wizard or login
    if (err.message && (err.message.includes('Authentication failed') || 
                         err.message.includes('requires authentication') ||
                         err.message.includes('Unauthorized'))) {
      console.log('🔒 MongoDB has auth enabled - credentials file may be invalid');
    }
  }
  
  return null;
}

/**
 * Check if this is first-time setup
 * Logic (in priority order):
 *   1. If credentials file exists with valid URI → already installed → LOGIN
 *   2. Try to connect and check users collection
 *   3. Default to first-time setup if uncertain
 */
async function isFirstTimeSetup() {
  console.log('🔍 Checking installation state...');
  
  // Priority 1: Credentials file is the strongest signal of completed installation
  const credentialsFiles = [
    path.join(getWritableBasePath(), '.mongodb-credentials.json'),
    path.join(__dirname, '.mongodb-credentials.json'),
    path.join(__dirname, 'api', '.mongodb-credentials.json'),
  ];
  
  for (const credFile of credentialsFiles) {
    if (fs.existsSync(credFile)) {
      try {
        const creds = JSON.parse(fs.readFileSync(credFile, 'utf8'));
        if (creds.uri && creds.username) {
          console.log(`✅ Credentials file found at: ${credFile}`);
          console.log('✅ Installation already completed - showing LOGIN page');
          process.env.MONGODB_URI = creds.uri;
          return false;
        }
      } catch (e) {
        console.warn(`⚠️ Invalid credentials file: ${credFile}`);
      }
    }
  }
  
  // Priority 2: Try database connection check
  console.log('� No credentials file found - checking database...');
  const workingUri = await getWorkingMongoUri();
  
  if (!workingUri) {
    console.log('⚠️ Cannot connect to MongoDB - first time setup');
    return true;
  }
  
  // Update MONGODB_URI to working one
  process.env.MONGODB_URI = workingUri;
  
  try {
    const client = new MongoClient(workingUri, {
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000
    });
    await client.connect();
    
    const db = client.db(DB_NAME);
    
    // Check if users collection exists
    const collections = await db.listCollections({ name: 'users' }).toArray();
    if (collections.length === 0) {
      console.log('📋 First time setup - users collection does not exist');
      await client.close();
      return true;
    }
    
    // Count users
    const userCount = await db.collection('users').countDocuments();
    await client.close();
    
    if (userCount === 0) {
      console.log('📋 First time setup - users collection is empty');
      return true;
    }
    
    // Users exist → skip wizard, go to login
    console.log(`✅ Found ${userCount} existing user(s) - showing LOGIN page`);
    return false;
  } catch (error) {
    console.error('⚠️ Error checking users collection:', error.message);
    // On error, default to showing wizard
    return true;
  }
}

/*
 * installDemoData stood here, seeding a first user of admin / admin123.
 *
 * It was never called - a database with no users shows the installation
 * wizard, and the operator chooses their own credentials there. But the
 * password was a literal in a file that ships inside the installer, so
 * publishing this repository would have published what reads like a working
 * default login for every Posnic ever installed. Dead code is no defence: it
 * needs one caller to become true.
 */

async function setupMongoDB() {
  console.log('\n============================================================');
  console.log('MongoDB Setup Check');
  console.log('============================================================\n');

  // Normal-launch fast path. This file only exists after setup completes;
  // server.js performs the authoritative connection when the API boots.
  const savedMongoUri = loadCredentials();
  if (savedMongoUri) {
    process.env.MONGODB_URI = savedMongoUri;
    console.log('Existing installation found - using startup fast path');
    return {
      success: true,
      userCount: null,
      needsWizard: false,
      mongoUri: savedMongoUri
    };
  }
  
  // Check if MongoDB is installed and running
  const mongoReady = await checkMongoDBInstalled();
  
  if (!mongoReady) {
    console.error('\n❌ MongoDB is not available');
    console.error('\n📋 MongoDB is required to run Posnic');
    console.error('\n╔════════════════════════════════════════════════════════╗');
    console.error('║  QUICK INSTALL: Run "install-mongodb.bat"             ║');
    console.error('╚════════════════════════════════════════════════════════╝');
    return { success: false, userCount: 0, needsWizard: false };
  }
  
  // Check if this is first time setup based on user count
  const isFirstTime = await isFirstTimeSetup();
  
  if (isFirstTime) {
    console.log('\n🎉 First time setup - showing INSTALLATION WIZARD\n');
    return { success: true, userCount: 0, needsWizard: true };
  }
  
  // Users exist - go to LOGIN page
  console.log('\n✅ Existing installation detected - showing LOGIN page\n');
  
  // Get user count for info
  try {
    const client = new MongoClient(process.env.MONGODB_URI || MONGODB_URI);
    await client.connect();
    const userCount = await client.db(DB_NAME).collection('users').countDocuments();
    await client.close();
    return { success: true, userCount, needsWizard: false };
  } catch (error) {
    return { success: true, userCount: 0, needsWizard: false };
  }
}

module.exports = { setupMongoDB, checkMongoDBInstalled, getWorkingMongoUri };

// Run setup if called directly
if (require.main === module) {
  setupMongoDB().then((result) => {
    if (result.success) {
      console.log('\n✅ Setup completed successfully!');
      if (result.needsWizard) {
        console.log('\n📋 Please complete the installation wizard');
      } else {
        console.log('\n✅ You can now login with your credentials');
      }
    } else {
      console.log('\n⚠️  Setup completed with some errors');
    }
    process.exit(result.success ? 0 : 1);
  });
}
