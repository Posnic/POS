require('dotenv').config();
const mongoose = require('mongoose');

async function cleanupReceivings() {
  const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/posnic';
  
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ Connected to MongoDB');

    const db = mongoose.connection.db;
    const collection = db.collection('receivings');

    // Find records with null receiving_number
    const nullRecords = await collection.find({ receiving_number: null }).toArray();
    console.log(`\n📊 Found ${nullRecords.length} records with null receiving_number`);

    if (nullRecords.length > 0) {
      console.log('\n📋 Sample records:');
      nullRecords.slice(0, 5).forEach((record, index) => {
        console.log(`  ${index + 1}. ID: ${record._id}`);
        console.log(`     receiving_id: ${record.receiving_id || 'null'}`);
        console.log(`     supplier_name: ${record.supplier_name || 'N/A'}`);
        console.log(`     created_date: ${record.created_date || 'N/A'}`);
        console.log(`     total_amount: ${record.total_amount || 0}`);
      });

      console.log('\n🗑️  Deleting records with null receiving_number...');
      const deleteResult = await collection.deleteMany({ receiving_number: null });
      console.log(`✅ Deleted ${deleteResult.deletedCount} records`);
    } else {
      console.log('✅ No records with null receiving_number found');
    }

    // Check for duplicate receiving_numbers
    console.log('\n🔍 Checking for duplicate receiving_numbers...');
    const duplicates = await collection.aggregate([
      { $match: { receiving_number: { $ne: null } } },
      { $group: { _id: '$receiving_number', count: { $sum: 1 }, ids: { $push: '$_id' } } },
      { $match: { count: { $gt: 1 } } }
    ]).toArray();

    if (duplicates.length > 0) {
      console.log(`⚠️  Found ${duplicates.length} duplicate receiving_numbers:`);
      duplicates.forEach(dup => {
        console.log(`  - ${dup._id}: ${dup.count} records (IDs: ${dup.ids.join(', ')})`);
      });
    } else {
      console.log('✅ No duplicate receiving_numbers found');
    }

    console.log('\n✅ Cleanup completed successfully!');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Database connection closed');
    process.exit(0);
  }
}

cleanupReceivings();
