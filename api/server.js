const dotenv = require("dotenv");

// Load environment variables FIRST
dotenv.config({ path: "./.env", quiet: true });

const mongoose = require("mongoose");

// Before anything is served: the secrets this installation signs with are
// generated per machine and passed in. Starting without them would mean
// falling back to something shared, which is exactly what this replaced.
require("./src/config/verify-secrets").verifySecrets();

const app = require("./app");
const config = require("./src/config/config");

// Handle uncaught exceptions
process.on("uncaughtException", (err) => {
  console.log("❌ UNCAUGHT EXCEPTION! Shutting down...");
  console.log(err.name, err.message);
  console.error(err);
  process.exit(1);
});

// Get MongoDB URI from environment
const DB_URI = config.database.uri || process.env.MONGODB_URI || "mongodb://localhost:27017/PosnicPro";

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
    console.log("✅ MongoDB Connected Successfully!");
    console.log(`📊 Database: ${mongoose.connection.name}`);
    console.log(`🔗 Host: ${mongoose.connection.host}`);
  } catch (error) {
    console.error("❌ MongoDB Connection Error:", error.message);
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
    const { migrateOptionalEmailIndexes } = require("./src/database/migrations/optional-email-indexes");
    await migrateOptionalEmailIndexes(mongoose.connection.db);

    // Add MongoDB client to app.locals for session management
    const { MongoClient } = require('mongodb');
    /* Sessions only. A second pool of 100 alongside mongoose's own was most of
       the socket count above, for a workload of one lookup per request. */
    const mongoClient = new MongoClient(DB_URI, { maxPoolSize: POOL_SIZE });
    await mongoClient.connect();
    app.locals.mongoClient = mongoClient;
    console.log("✅ MongoDB Client added to app.locals for session management");

    // Start Express server
    // Default to port 5000 to match Frontend login API_URL (http://localhost:5000/)
    // while still allowing override via the PORT environment variable.
    const PORT = process.env.PORT || 5000;
    const HOST = process.env.HOST || config.server?.host || config.host || "0.0.0.0";
    const server = app.listen(PORT, HOST, () => {
      console.log("🚀 =====================================");
      console.log(`🚀 Server running on http://localhost:${PORT}`);
      console.log(`🚀 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`🚀 API Endpoint: http://localhost:${PORT}/api`);
      console.log("🚀 =====================================");
    });

    // Handle unhandled promise rejections
    process.on("unhandledRejection", (err) => {
      console.log("❌ UNHANDLED REJECTION! Shutting down...");
      console.log(err.name, err.message);
      console.error(err);
      server.close(() => {
        process.exit(1);
      });
    });

    // Graceful shutdown
    process.on("SIGTERM", () => {
      console.log("👋 SIGTERM RECEIVED. Shutting down gracefully...");
      server.close(() => {
        console.log("💥 Process terminated!");
      });
    });

    return server;
  } catch (error) {
    console.error("❌ Server Startup Error:", error);
    process.exit(1);
  }
};

// Start the server
startServer();
