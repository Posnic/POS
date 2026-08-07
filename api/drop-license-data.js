// Drop all records for a specific license ID
const { MongoClient, ObjectId } = require('mongodb');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/PosnicPro';
const LICENSE_ID = '507f1f77bcf86cd799439011';

async function dropLicenseData() {
  const client = new MongoClient(MONGODB_URI);
  
  try {
    await client.connect();
    console.log('Connected to MongoDB');
    
    const db = client.db();
    const licenseObjectId = new ObjectId(LICENSE_ID);
    
    console.log(`\nRemoving all records for license: ${LICENSE_ID}\n`);
    
    // Get all collections
    const collections = await db.listCollections().toArray();
    
    let totalDeleted = 0;
    
    for (const collectionInfo of collections) {
      const collectionName = collectionInfo.name;
      const collection = db.collection(collectionName);
      
      try {
        // Try to delete documents with this license ID
        const result = await collection.deleteMany({ license: licenseObjectId });
        
        if (result.deletedCount > 0) {
          console.log(`✅ ${collectionName}: Deleted ${result.deletedCount} records`);
          totalDeleted += result.deletedCount;
        }
      } catch (error) {
        // Skip collections that don't have a license field
        // console.log(`⏭️  ${collectionName}: Skipped (no license field)`);
      }
    }
    
    console.log(`\n✅ Total records deleted: ${totalDeleted}`);
    
  } catch (error) {
    console.error('❌ Error removing license data:', error.message);
    process.exit(1);
  } finally {
    await client.close();
    console.log('\nMongoDB connection closed');
  }
}

dropLicenseData();
