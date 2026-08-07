const fs = require('fs');
const path = require('path');

const templatePath = path.join(
  __dirname,
  '..',
  'node_modules',
  'app-builder-lib',
  'templates',
  'nsis',
  'installSection.nsh'
);

if (!fs.existsSync(templatePath)) {
  console.error(`electron-builder NSIS template not found: ${templatePath}`);
  process.exit(1);
}

const hiddenDetails = 'SetDetailsPrint none';
const visibleDetails = 'SetDetailsPrint both';
const template = fs.readFileSync(templatePath, 'utf8');

if (template.includes(visibleDetails)) {
  console.log('Installer extraction details are already enabled.');
  process.exit(0);
}

if (!template.includes(hiddenDetails)) {
  console.error('Unsupported electron-builder NSIS template: details setting was not found.');
  process.exit(1);
}

fs.writeFileSync(templatePath, template.replace(hiddenDetails, visibleDetails), 'utf8');
console.log('Enabled file extraction details on the installer progress page.');
