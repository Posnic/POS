// Quick script to enable stock management for all branches
// This will allow stock logs to be created

const { MongoClient, ObjectId } = require('mongodb');
require('dotenv').config();

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/PosnicPro';
const DB_NAME = MONGO_URI.split('/').pop().split('?')[0];

async function enableStockManagement() {
  const client = new MongoClient(MONGO_URI);
  
  try {
    await client.connect();
    console.log('✅ Connected to MongoDB');
    
    const db = client.db(DB_NAME);
    const branchesCollection = db.collection('branches');
    
    // Check current state
    console.log('\n📊 Current Branch Settings:');
    const branches = await branchesCollection.find({}).toArray();
    
    for (const branch of branches) {
      console.log(`\nBranch: ${branch.branch_name || branch._id}`);
      console.log(`  - stock_management: ${branch.stock_management}`);
      console.log(`  - stock_management_log: ${branch.stock_management_log}`);
    }
    
    // Update all branches to enable stock management
    console.log('\n🔄 Enabling stock management for all branches...');
    
    const result = await branchesCollection.updateMany(
      {},
      { 
        $set: { 
          stock_management: true,
          stock_management_log: true
        } 
      }
    );
    
    console.log(`\n✅ Updated ${result.modifiedCount} branch(es)`);
    
    // Verify
    console.log('\n📊 Updated Branch Settings:');
    const updatedBranches = await branchesCollection.find({}).toArray();
    
    for (const branch of updatedBranches) {
      console.log(`\nBranch: ${branch.branch_name || branch._id}`);
      console.log(`  - stock_management: ${branch.stock_management} ✅`);
      console.log(`  - stock_management_log: ${branch.stock_management_log} ✅`);
    }
    
    console.log('\n✅ Stock management enabled! Stock logs will now be created.');
    console.log('📝 Please restart your server (npm run dev) for changes to take effect.');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.close();
  }
}

enableStockManagement();
