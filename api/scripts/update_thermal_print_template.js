/**
 * Script to update thermal_body_print template for all branches
 * Adds sale notes section to thermal print receipts
 * 
 * Usage: node scripts/update_thermal_print_template.js
 */

const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

// Load environment variables if .env file exists
try {
  require('dotenv').config();
} catch (e) {
  console.log('dotenv not available, using environment variables');
}

// MongoDB connection string
const MONGODB_URI = process.env.MONGODB_URI || 
                    process.env.MONGO_URI || 
                    'mongodb://localhost:27017/PosnicPro';

async function updateThermalTemplate() {
  let connection;
  
  try {
    console.log('Connecting to MongoDB...');
    console.log('URI:', MONGODB_URI.replace(/\/\/([^:]+):([^@]+)@/, '//$1:****@')); // Hide password in log
    
    connection = await mongoose.connect(MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    
    console.log('✓ Connected to MongoDB successfully\n');

    // Load the new thermal template with sale notes
    const templatePath = path.join(__dirname, '../src/json/print_standard_html.txt');
    console.log('Reading template from:', templatePath);
    
    const newTemplate = fs.readFileSync(templatePath, 'utf8');
    console.log('✓ Template loaded successfully\n');

    // Get the Branch collection
    const db = mongoose.connection.db;
    const branchesCollection = db.collection('branches');

    // Count total branches
    const totalBranches = await branchesCollection.countDocuments();
    console.log(`Found ${totalBranches} branches in database\n`);

    if (totalBranches === 0) {
      console.log('No branches found to update');
      return;
    }

    // Update all branches with the new thermal template
    console.log('Updating thermal_body_print for all branches...');
    const result = await branchesCollection.updateMany(
      {}, // Update all branches
      { 
        $set: { 
          thermal_body_print: newTemplate 
        } 
      }
    );

    console.log('\n✓ Update completed successfully!');
    console.log(`  - Matched: ${result.matchedCount} branches`);
    console.log(`  - Modified: ${result.modifiedCount} branches`);
    
    if (result.modifiedCount === 0 && totalBranches > 0) {
      console.log('\n⚠ No branches were modified. They may already have the latest template.');
    }

    // Show sample of updated branch
    const sampleBranch = await branchesCollection.findOne(
      {}, 
      { projection: { branch_name: 1, _id: 1 } }
    );
    
    if (sampleBranch) {
      console.log(`\nSample updated branch: ${sampleBranch.branch_name} (${sampleBranch._id})`);
    }

  } catch (error) {
    console.error('\n✗ Error updating thermal template:');
    console.error(error.message);
    
    if (error.code === 'ENOENT') {
      console.error('\nTemplate file not found. Please ensure the file exists at:');
      console.error(path.join(__dirname, '../src/json/print_standard_html.txt'));
    } else if (error.name === 'MongoServerError') {
      console.error('\nMongoDB connection error. Please check:');
      console.error('1. MongoDB is running');
      console.error('2. Connection string is correct');
      console.error('3. Database credentials are valid');
    }
    
    process.exit(1);
  } finally {
    if (connection) {
      await mongoose.connection.close();
      console.log('\n✓ MongoDB connection closed');
    }
  }
}

// Run the update
console.log('='.repeat(60));
console.log('Thermal Print Template Update Script');
console.log('='.repeat(60));
console.log();

updateThermalTemplate()
  .then(() => {
    console.log('\n' + '='.repeat(60));
    console.log('Script completed successfully');
    console.log('='.repeat(60));
    process.exit(0);
  })
  .catch((error) => {
    console.error('\nUnexpected error:', error);
    process.exit(1);
  });
