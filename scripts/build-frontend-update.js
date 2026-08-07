/**
 * web-Only Update Package Builder
 * 
 * Creates update packages with only web changes
 * Usage: node build-frontend-update.js [version] [output-dir]
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const archiver = require('archiver');

async function buildwebUpdatePackage(version = '1.0.1', outputDir = './update-packages') {
  console.log(`🔧 Building web-only update package v${version}...\n`);
  
  try {
    const updateDir = path.join(outputDir, `frontend-update-${version}`);
    const zipFilePath = path.join(outputDir, `posnic-frontend-update-v${version}.zip`);
    
    // Clean up existing files
    if (fs.existsSync(zipFilePath)) fs.unlinkSync(zipFilePath);
    if (fs.existsSync(updateDir)) {
      fs.rmSync(updateDir, { recursive: true, force: true });
    }
    
    // Create update directory structure
    fs.mkdirSync(updateDir, { recursive: true });
    fs.mkdirSync(path.join(updateDir, 'updates'), { recursive: true });
    
    console.log('📦 Including web files only...');
    
    // Define files to include (web only)
    const updateFiles = {};
    
    // Include web directory if it exists
    const frontendPath = path.join(__dirname, '..', 'frontend');
    if (fs.existsSync(frontendPath)) {
      updateFiles['frontend/'] = frontendPath;
      console.log(`   ✅ web/ (directory)`);
    } else {
      console.log(`   ⚠️  web/ - directory not found`);
    }
    
    // Include frontend build files from installer directory
    const installerwebPath = path.join(__dirname, 'frontend');
    if (fs.existsSync(installerwebPath)) {
      updateFiles['frontend/'] = installerwebPath;
      console.log(`   ✅ frontend/ (installer build files)`);
    }
    
    // Include public static files if they exist
    const publicPath = path.join(__dirname, '..', 'public');
    if (fs.existsSync(publicPath)) {
      updateFiles['public/'] = publicPath;
      console.log(`   ✅ public/ (static files)`);
    }
    
    // Copy files to update directory
    console.log('\n📦 Copying web files to update package...');
    let totalFiles = 0;
    
    for (const [targetPath, sourcePath] of Object.entries(updateFiles)) {
      const destPath = path.join(updateDir, 'updates', targetPath);
      
      if (fs.statSync(sourcePath).isDirectory()) {
        // Copy directory
        copyDirectory(sourcePath, destPath);
        const fileCount = countFiles(sourcePath);
        totalFiles += fileCount;
        console.log(`   ✅ ${targetPath} (${fileCount} files)`);
      } else {
        // Copy single file
        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        fs.copyFileSync(sourcePath, destPath);
        totalFiles++;
        console.log(`   ✅ ${targetPath}`);
      }
    }
    
    // Create web-only manifest.json
    const manifest = {
      version: version,
      releaseDate: new Date().toISOString(),
      checksum: '', // Will be calculated
      changelog: [
        'web-only update',
        'Updated UI components and styles',
        'Improved user experience',
        'No backend changes included'
      ],
      requirements: {
        minVersion: '1.0.0',
        nodeVersion: '>=14.0.0',
        platforms: ['win32', 'darwin', 'linux']
      },
      files: Object.keys(updateFiles),
      metadata: {
        totalFiles: totalFiles,
        buildDate: new Date().toISOString(),
        buildEnvironment: process.platform,
        updateType: 'frontend-only',
        estimatedSize: 'Small to Medium',
        components: ['frontend', 'UI', 'Static Files'],
        excludes: ['api/', 'node_modules/', 'Backend/']
      },
      nodeModules: {
        required: false,
        downloadUrl: null,
        checksum: null
      }
    };
    
    fs.writeFileSync(
      path.join(updateDir, 'updates', 'manifest.json'),
      JSON.stringify(manifest, null, 2)
    );
    
    console.log(`   ✅ manifest.json`);
    
    // Create the zip file
    console.log(`\n🗜️  Creating web-only zip archive...`);
    const output = fs.createWriteStream(zipFilePath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    
    archive.pipe(output);
    archive.directory(updateDir, false);
    
    await archive.finalize();
    
    // Calculate checksum
    const fileBuffer = fs.readFileSync(zipFilePath);
    const hashSum = crypto.createHash('sha256');
    hashSum.update(fileBuffer);
    const checksum = hashSum.digest('hex');
    
    // Update manifest with checksum
    manifest.checksum = checksum;
    fs.writeFileSync(
      path.join(updateDir, 'updates', 'manifest.json'),
      JSON.stringify(manifest, null, 2)
    );
    
    // Recreate zip with updated manifest
    fs.unlinkSync(zipFilePath);
    const output2 = fs.createWriteStream(zipFilePath);
    const archive2 = archiver('zip', { zlib: { level: 9 } });
    
    archive2.pipe(output2);
    archive2.directory(updateDir, false);
    await archive2.finalize();
    
    // Final checksum and size
    const finalFileBuffer = fs.readFileSync(zipFilePath);
    const finalHashSum = crypto.createHash('sha256');
    finalHashSum.update(finalFileBuffer);
    const finalChecksum = finalHashSum.digest('hex');
    
    console.log(`\n✅ web-only update package created successfully!`);
    console.log(`📦 File: ${zipFilePath}`);
    console.log(`📏 Size: ${(finalFileBuffer.length / 1024 / 1024).toFixed(2)} MB`);
    console.log(`🔐 Checksum: ${finalChecksum}`);
    console.log(`📄 Files: ${totalFiles}`);
    console.log(`🎯 Type: web-only update`);
    console.log(`📦 Node modules: Not required`);
    
    // Clean up temporary directory
    try {
      fs.rmSync(updateDir, { recursive: true, force: true });
    } catch (cleanErr) {
      console.warn(`⚠️  Could not clean up temp directory: ${cleanErr.message}`);
    }
    
    console.log(`\n🚀 web-only benefits:`);
    console.log(`   ✅ Faster download (no backend files)`);
    console.log(`   ✅ Lower bandwidth usage`);
    console.log(`   ✅ Quick installation`);
    console.log(`   ✅ Only UI changes applied`);
    console.log(`   ✅ Safe for production deployment`);
    
    console.log(`\n📋 To use this web update:`);
    console.log(`   1. Update test server with checksum: ${finalChecksum}`);
    console.log(`   2. Test update in Posnic`);
    console.log(`   3. Only web files will be updated`);
    
  } catch (error) {
    console.error('❌ Build failed:', error.message);
    console.error(error.stack);
  }
}

function copyDirectory(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  
  const entries = fs.readdirSync(src, { withFileTypes: true });
  
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    
    if (entry.isDirectory()) {
      copyDirectory(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function countFiles(dir) {
  let count = 0;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    if (entry.isDirectory()) {
      count += countFiles(path.join(dir, entry.name));
    } else {
      count++;
    }
  }
  
  return count;
}

// Run build if called directly
if (require.main === module) {
  const version = process.argv[2] || '1.0.1';
  const outputDir = process.argv[3] || './update-packages';
  
  buildwebUpdatePackage(version, outputDir);
}

module.exports = { buildwebUpdatePackage };
