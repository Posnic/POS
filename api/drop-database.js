// Drop MongoDB database for clean installation test
const { MongoClient } = require('mongodb');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/PosnicPro';

async function dropDatabase() {
  const client = new MongoClient(MONGODB_URI);
  
  try {
    await client.connect();
    console.log('Connected to MongoDB');
    
    const db = client.db();
    const dbName = db.databaseName;
    
    console.log(`Dropping database: ${dbName}`);
    await db.dropDatabase();
    console.log(`✅ Database '${dbName}' dropped successfully`);
    
  } catch (error) {
    console.error('❌ Error dropping database:', error.message);
    process.exit(1);
  } finally {
    await client.close();
    console.log('MongoDB connection closed');
  }
}

dropDatabase();
