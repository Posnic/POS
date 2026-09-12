const dotenv = require('dotenv');

// Load environment variables FIRST
dotenv.config({ path: './.env', quiet: true });

const mongoose = require('mongoose');

// Before anything is served: the secrets this installation signs with are
// generated per machine and passed in. Starting without them would mean
// falling back to something shared, which is exactly what this replaced.
require('./src/config/verify-secrets').verifySecrets();

const app = require('./app');
const config = require('./src/config/config');

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.log('❌ UNCAUGHT EXCEPTION! Shutting down...');
  console.log(err.name, err.message);
  console.error(err);
  process.exit(1);
});

// Get MongoDB URI from environment
const DB_URI =
  config.database.uri || process.env.MONGODB_URI || 'mongodb://localhost:27017/PosnicPro';

/*
 * Pool size, applied here because here is where the connection is actually made.
 *
 * src/config/database.js has carried a considered set of options - maxPoolSize
 * from MAX_POOL_SIZE, timeouts, retry settings - since before this file existed,
 * and nothing has ever required it. So MAX_POOL_SIZE=5 was set in twenty tenant
 * env files and changed nothing: both connections below used the driver default
 * of 100, giving each shop a ceiling of 200 sockets. Twenty shops idling held
 * 1,052 open connections against the server.
 *
 * A till serves one shop and a handful of devices. Five is generous for that,
 * and the number matters more than it looks: when many shops share one machine,
 * the pool is per-process, so the ceiling is multiplied by however many are
 * running.
 */
const POOL_SIZE = parseInt(process.env.MAX_POOL_SIZE, 10) || 5;

// Connect to database
const connectDB = async () => {
  try {
    await mongoose.connect(DB_URI, { maxPoolSize: POOL_SIZE });
    console.log('✅ MongoDB Connected Successfully!');
    console.log(`📊 Database: ${mongoose.connection.name}`);
    console.log(`🔗 Host: ${mongoose.connection.host}`);
  } catch (error) {
    console.error('❌ MongoDB Connection Error:', error.message);
    process.exit(1);
  }
};

// Start server function
const startServer = async () => {
  try {
    // Connect to database first
    await connectDB();

    // Normalize optional email values and reconcile legacy non-sparse unique
    // indexes before accepting writes.
    const {
      migrateOptionalEmailIndexes,
    } = require('./src/database/migrations/optional-email-indexes');
    await migrateOptionalEmailIndexes(mongoose.connection.db);

    // Versioned, ledgered schema migrations (SEAMLESS_UPDATE_ROADMAP U1.3):
    // every not-yet-applied entry in src/db/migrations/index.js runs before
    // the server accepts traffic, recorded per database in schema_migrations.
    // In cloud multi-tenant serving, the deploy pipeline runs these per tenant
    // database instead of at boot.
    const { runMigrations } = require('./src/db/migrations');
    const migrationRegistry = require('./src/db/migrations/index');
    const { applied } = await runMigrations(mongoose.connection.db, migrationRegistry);
    if (applied.length) {
      console.log(`✅ Schema migrations applied: ${applied.join(', ')}`);
    }

    // Add MongoDB client to app.locals for session management
    const { MongoClient } = require('mongodb');
    /* Sessions only. A second pool of 100 alongside mongoose's own was most of
       the socket count above, for a workload of one lookup per request. */
    const mongoClient = new MongoClient(DB_URI, { maxPoolSize: POOL_SIZE });
    await mongoClient.connect();
    app.locals.mongoClient = mongoClient;
    console.log('✅ MongoDB Client added to app.locals for session management');

    // Start Express server
    // Default to port 5000 to match Frontend login API_URL (http://localhost:5000/)
    // while still allowing override via the PORT environment variable.
    const PORT = process.env.PORT || 5000;
    const HOST = process.env.HOST || config.server?.host || config.host || '0.0.0.0';
    const server = app.listen(PORT, HOST, () => {
      console.log('🚀 =====================================');
      console.log(`🚀 Server running on http://localhost:${PORT}`);
      console.log(`🚀 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`🚀 API Endpoint: http://localhost:${PORT}/api`);
      console.log('🚀 =====================================');
    });

    /*
     * AND ON 5555, SO A HANDSET CAN FIND THIS TILL.
     *
     * The desktop app stopped assuming 5555 for good reasons - it derives its
     * port from the brand name now, because 5555 collides with whatever else
     * on the machine had the same idea, and two brands on one machine needed
     * two ports. src/local-ports.js says so in as many words: "Neither range
     * is ours to assume."
     *
     * The handset was never told. It sweeps the LAN for port 5555 and nothing
     * else, so it probes 254 addresses on a port the till abandoned and finds
     * nothing - on every network, for every shop. Measured on a real install:
     * the till answers /api/runtime-info on its derived port and refuses the
     * connection on 5555, which is exactly what a sweep sees.
     *
     * Fixing it in the app would leave every handset already in the field
     * unable to pair until somebody updated it. Fixing it here costs one more
     * listener on the same Express app and works for versions that shipped
     * months ago.
     *
     * It is a COURTESY, not a requirement. If 5555 is busy - the collision
     * that moved us off it in the first place - this logs and carries on; the
     * till is already serving on its real port and pairing by shop code or by
     * scanning the QR is unaffected.
     */
    const DISCOVERY_PORT = Number(process.env.POSNIC_DISCOVERY_PORT) || 5555;
    if (String(PORT) !== String(DISCOVERY_PORT)) {
      const discovery = app.listen(DISCOVERY_PORT, HOST);
      discovery.on('listening', () => {
        console.log(
          `🔎 Also answering on http://localhost:${DISCOVERY_PORT}/api for handset discovery`
        );
      });
      discovery.on('error', (err) => {
        /* EADDRINUSE is the ordinary case on a machine that already runs
           something there. Nothing is broken; discovery just cannot use it. */
        console.log(
          `🔎 Port ${DISCOVERY_PORT} is not available for handset discovery (${err.code || err.message}). ` +
            'Pair by shop code or by scanning the code on the till.'
        );
      });
    }

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (err) => {
      console.log('❌ UNHANDLED REJECTION! Shutting down...');
      console.log(err.name, err.message);
      console.error(err);
      server.close(() => {
        process.exit(1);
      });
    });

    // Graceful shutdown
    process.on('SIGTERM', () => {
      console.log('👋 SIGTERM RECEIVED. Shutting down gracefully...');
      server.close(() => {
        console.log('💥 Process terminated!');
      });
    });

    return server;
  } catch (error) {
    console.error('❌ Server Startup Error:', error);
    process.exit(1);
  }
};

// Start the server
startServer();
