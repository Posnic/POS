const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

const publicDir = path.join(__dirname, 'public');
const outputPath = path.join(publicDir, 'all.zip');

// Check if public directory exists
if (!fs.existsSync(publicDir)) {
    console.error('Error: public folder does not exist');
    process.exit(1);
}

// Create a file to stream archive data to
const output = fs.createWriteStream(outputPath);
const archive = archiver('zip', {
    zlib: { level: 9 } // Set compression level
});

// Listen for all archive data to be written
output.on('close', function() {
    console.log(`Created all.zip (${archive.pointer()} total bytes)`);
    console.log('Zip file created successfully at public/all.zip');
});

// Handle warnings (non-blocking errors)
archive.on('warning', function(err) {
    if (err.code === 'ENOENT') {
        console.warn('Warning:', err);
    } else {
        throw err;
    }
});

// Handle errors
archive.on('error', function(err) {
    throw err;
});

// Pipe archive data to the file
archive.pipe(output);

// Add all files and folders from public directory except the zip file itself
fs.readdirSync(publicDir).forEach(file => {
    const filePath = path.join(publicDir, file);
    const stat = fs.statSync(filePath);
    
    // Skip the zip file itself to avoid recursion
    if (file === 'all.zip') {
        return;
    }
    
    if (stat.isDirectory()) {
        // Add directory recursively
        archive.directory(filePath, file);
    } else {
        // Add individual file
        archive.file(filePath, { name: file });
    }
});

// Finalize the archive
archive.finalize();
