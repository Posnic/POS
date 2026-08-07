const mongoose = require('mongoose');
const path = require('path');
const { mongo, env, isProduction } = require('./environment');

// Set mongoose Promise to bluebird
mongoose.Promise = Promise;

// MongoDB connection options
const getMongoOptions = () => ({
  maxPoolSize: parseInt(process.env.MAX_POOL_SIZE) || 10,
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: parseInt(process.env.SOCKET_TIMEOUT) || 30000,
  connectTimeoutMS: parseInt(process.env.CONNECTION_TIMEOUT) || 10000,
  retryWrites: true,
  retryReads: true,
  ...(isProduction && {
    ssl: true,
    sslValidate: true,
    sslCA: process.env.MONGODB_CA_CERT_PATH,
    authMechanism: 'DEFAULT',
    authSource: 'admin',
  }),
});

// Connect to MongoDB
const connect = async () => {
  try {
    await mongoose.connect(mongo.uri, getMongoOptions());
    console.log(`MongoDB connected in ${env} mode`);
  } catch (error) {
    console.error('MongoDB connection error:', error);
    process.exit(1);
  }
};

// Event handlers for MongoDB connection
mongoose.connection.on('connected', () => {
  console.log('Mongoose connected to database');
});

mongoose.connection.on('error', (err) => {
  console.error('Mongoose connection error:', err);
});

mongoose.connection.on('disconnected', () => {
  console.log('Mongoose disconnected from database');
});

mongoose.connection.on('reconnected', () => {
  console.log('MongoDB reconnected');
});

// Close the Mongoose connection when the Node process ends
process.on('SIGINT', async () => {
  try {
    await mongoose.connection.close();
    console.log('MongoDB connection closed through app termination');
    process.exit(0);
  } catch (error) {
    console.error('Error closing MongoDB connection:', error);
    process.exit(1);
  }
});

// Collection names
const collections = {
  users: 'users',
  sessions: 'sessions',
};

// Index configurations
const indexes = {
  users: [
    {
      keys: { email: 1 },
      options: { unique: true, sparse: true },
    },
    {
      keys: { phone: 1 },
      options: {
        unique: true,
        sparse: true,
        partialFilterExpression: { phone: { $exists: true } },
      },
    },
  ],
};

// Migration settings
const migrations = {
  migrationsDir: path.join(__dirname, '../database/migrations'),
  changelogCollection: 'migrations',
  migrationFileExtension: '.js',
};

module.exports = {
  connect,
  mongoose,
  connection: mongoose.connection,
  getMongoOptions,
  collections,
  indexes,
  migrations,
};
