const { MongoClient } = require('mongodb');

async function cleanupReceivings() {
  // Use the same connection string as the app
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/PosnicPro';
  const client = new MongoClient(uri);

  try {
    await client.connect();
    console.log('Connected to MongoDB');

    const db = client.db('PosnicPro');
    const collection = db.collection('receivings');

    // Find records with null receiving_number
    const nullRecords = await collection.find({ receiving_number: null }).toArray();
    console.log(`Found ${nullRecords.length} records with null receiving_number`);

    if (nullRecords.length > 0) {
      console.log('Sample records:');
      nullRecords.slice(0, 3).forEach(record => {
        console.log(`  - ID: ${record._id}, receiving_id: ${record.receiving_id}, created_date: ${record.created_date}`);
      });

      // Delete records with null receiving_number
      const deleteResult = await collection.deleteMany({ receiving_number: null });
      console.log(`\n✅ Deleted ${deleteResult.deletedCount} records with null receiving_number`);
    } else {
      console.log('✅ No records with null receiving_number found');
    }

    // Also check for duplicate receiving_numbers
    const duplicates = await collection.aggregate([
      { $match: { receiving_number: { $ne: null } } },
      { $group: { _id: '$receiving_number', count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } }
    ]).toArray();

    if (duplicates.length > 0) {
      console.log(`\n⚠️ Found ${duplicates.length} duplicate receiving_numbers:`);
      duplicates.forEach(dup => {
        console.log(`  - ${dup._id}: ${dup.count} records`);
      });
    }

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await client.close();
    console.log('\nDatabase connection closed');
  }
}

cleanupReceivings();
