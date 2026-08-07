const mongoose = require("mongoose");
const { config } = require("../src/config");
const logger = require("../src/utils/logger");

/**
 * Test database connection
 */
async function testDatabaseConnection() {
  try {
    logger.info("Attempting to connect to MongoDB...");

    // Set up event listeners
    mongoose.connection.on("connecting", () => {
      logger.info("Connecting to MongoDB...");
    });

    mongoose.connection.on("connected", () => {
      logger.info("MongoDB connection established");
    });

    mongoose.connection.on("error", (err) => {
      logger.error("MongoDB connection error:", err);
    });

    // Connect to MongoDB
    await mongoose.connect(config.mongoose.url, config.mongoose.options);

    logger.info("✅ Successfully connected to MongoDB");

    // Test a simple query if needed
    const collections = await mongoose.connection.db
      .listCollections()
      .toArray();
    logger.info(`Found ${collections.length} collections in the database`);

    // Close the connection
    await mongoose.connection.close();
    logger.info("MongoDB connection closed");
  } catch (error) {
    logger.error("Failed to connect to MongoDB:", error);
    process.exit(1);
  }
}

// Run the test if this file is executed directly
if (require.main === module) {
  testDatabaseConnection()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = { testDatabaseConnection };
