const sharp = require('sharp');
/* png-to-ico, not to-ico: same job, but to-ico dragged in jimp 0.2 and the
   long-dead `request`, which between them were four of Dependabot's critical
   findings - for a script that runs when somebody redesigns the logo. */
const pngToIco = require('png-to-ico');
const fs = require('fs');
const path = require('path');

const pngSourcePath = path.join(__dirname, 'favicon.png');
const buildsDir = path.join(__dirname, 'builds');

async function convertSvgToIcons() {
  try {
    // Create multiple PNG sizes for ICO
    const sizes = [16, 32, 48, 64, 128, 256];
    const pngBuffers = [];

    for (const size of sizes) {
      console.log(`📦 Resizing PNG to ${size}x${size}...`);
      const buffer = await sharp(pngSourcePath)
        .resize(size, size, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
        .png()
        .toBuffer();
      pngBuffers.push(buffer);
      
      // Also save individual PNGs
      const pngPath = path.join(buildsDir, `icon-${size}.png`);
      fs.writeFileSync(pngPath, buffer);
      console.log(`✅ PNG created: ${pngPath}`);
    }

    // Convert PNGs to ICO (png-to-ico accepts an array of PNG buffers too)
    console.log('📦 Converting PNGs to ICO...');
    const icoBuffer = await pngToIco(pngBuffers);
    const icoPath = path.join(buildsDir, 'icon.ico');
    fs.writeFileSync(icoPath, icoBuffer);
    console.log(`✅ ICO created: ${icoPath}`);

    console.log('🎉 Icon conversion complete!');
  } catch (error) {
    console.error('❌ Error during conversion:', error);
    process.exit(1);
  }
}

convertSvgToIcons();
