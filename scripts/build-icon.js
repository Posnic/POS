const icongen = require('icon-gen');
const path = require('path');

const options = {
  type: 'png',
  modes: ['ico'],
  names: {
    ico: 'icon'
  },
  report: true
};

const input = path.join(__dirname, 'favicon.png');
const output = path.join(__dirname, 'builds');

console.log('🎨 Generating Windows ICO from favicon.png...');

icongen(input, output, options)
  .then((results) => {
    console.log('✅ ICO file generated successfully!');
    console.log('📁 Output:', results);
  })
  .catch((err) => {
    console.error('❌ Error generating ICO:', err);
    process.exit(1);
  });
