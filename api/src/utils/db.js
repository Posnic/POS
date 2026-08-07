const mongoose = require('mongoose');
const { logger } = require('./logger');

// MongoDB connection options
const options = {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 5000, // Timeout after 5s instead of 30s
  socketTimeoutMS: 45000, // Close sockets after 45s of inactivity
  maxPoolSize: 10, // Maximum number of connections in the connection pool
  minPoolSize: 1, // Minimum number of connections in the connection pool
  maxIdleTimeMS: 30000, // Remove connections after 30s of inactivity
  retryWrites: true,
  w: 'majority',
};

// Connection state tracking
const connectionState = {
  isConnected: false,
  isConnecting: false,
  retryCount: 0,
  maxRetries: 5,
  retryDelay: 5000, // 5 seconds
};

// Cache the connection to avoid multiple connections
let cachedConnection = null;

// Handle MongoDB connection events
const setupEventListeners = (connection) => {
  connection.on('connected', () => {
    connectionState.isConnected = true;
    connectionState.retryCount = 0;
    logger.info(`MongoDB connected: ${connection.host}`);
  });

  connection.on('error', (error) => {
    logger.error('MongoDB connection error:', error);
    connectionState.isConnected = false;
  });

  connection.on('disconnected', () => {
    logger.warn('MongoDB disconnected');
    connectionState.isConnected = false;
    // Attempt to reconnect if we're not already trying
    if (!connectionState.isConnecting) {
      connectWithRetry();
    }
  });

  connection.on('reconnected', () => {
    logger.info('MongoDB reconnected');
    connectionState.isConnected = true;
  });

  // Close the connection when the Node process ends
  process.on('SIGINT', async () => {
    try {
      await connection.close();
      logger.info('MongoDB connection closed due to app termination');
      process.exit(0);
    } catch (error) {
      logger.error('Error closing MongoDB connection:', error);
      process.exit(1);
    }
  });
};

// Connect to MongoDB with retry logic
const connectWithRetry = async () => {
  if (connectionState.isConnecting) {
    logger.debug('Connection attempt already in progress');
    return;
  }

  if (connectionState.retryCount >= connectionState.maxRetries) {
    logger.error('Max connection retries reached. Please check your MongoDB connection.');
    return;
  }

  const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/PosnicPro';

  try {
    connectionState.isConnecting = true;

    if (cachedConnection) {
      // If we already have a connection, ensure it's still valid
      if (mongoose.connection.readyState === 1) {
        connectionState.isConnected = true;
        return;
      }
      // Clean up the existing connection
      await mongoose.disconnect();
    }

    logger.info(
      `Attempting MongoDB connection (attempt ${connectionState.retryCount + 1}/${connectionState.maxRetries})...`
    );

    const connection = await mongoose.connect(MONGODB_URI, options);

    // Configure the connection
    mongoose.set('strictQuery', true);

    // Cache the connection
    cachedConnection = connection;

    // Set up event listeners
    setupEventListeners(connection.connection);

    return connection;
  } catch (error) {
    connectionState.retryCount++;
    const delay = connectionState.retryCount * connectionState.retryDelay;

    logger.error(
      `MongoDB connection failed (attempt ${connectionState.retryCount}/${connectionState.maxRetries}):`,
      error.message
    );

    if (connectionState.retryCount < connectionState.maxRetries) {
      logger.info(`Retrying connection in ${delay / 1000} seconds...`);
      setTimeout(connectWithRetry, delay);
    } else {
      logger.error('Max retries reached. Please check your MongoDB connection.');
      // In a production environment, you might want to exit the process
      // process.exit(1);
    }
  } finally {
    connectionState.isConnecting = false;
  }
};

// Connection check middleware
const checkConnection = async (req, res, next) => {
  if (!connectionState.isConnected) {
    logger.warn('Database connection check failed');
    return res.status(503).json({
      status: 'error',
      message: 'Database connection not available',
      code: 503,
    });
  }
  next();
};

// Transaction helper
const withTransaction = async (operations) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const result = await operations(session);
    await session.commitTransaction();
    return result;
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

// Health check
const checkHealth = async () => {
  try {
    if (mongoose.connection.readyState === 1) {
      // Run a simple query to verify the connection
      await mongoose.connection.db.admin().ping();
      return {
        status: 'ok',
        dbState: mongoose.STATES[mongoose.connection.readyState],
        connection: {
          host: mongoose.connection.host,
          port: mongoose.connection.port,
          name: mongoose.connection.name,
          user: mongoose.connection.user,
        },
        models: Object.keys(mongoose.connection.models),
      };
    }
    return {
      status: 'error',
      dbState: mongoose.STATES[mongoose.connection.readyState],
      message: 'Not connected to MongoDB',
    };
  } catch (error) {
    return {
      status: 'error',
      dbState: mongoose.STATES[mongoose.connection.readyState],
      error: error.message,
    };
  }
};

module.exports = {
  connect: connectWithRetry,
  checkConnection,
  withTransaction,
  checkHealth,
  connection: mongoose.connection,
  mongoose,
};
