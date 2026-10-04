const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
test('item v2 fields and families persist against MongoDB', async () => {
  try {
    await promisify(execFile)(
      process.execPath,
      ['--test', path.join(__dirname, '../../fixtures/item-v2-fields.cjs')],
      { timeout: 120000, maxBuffer: 2 * 1024 * 1024 }
    );
  } catch (error) {
    throw new Error(`${error.stdout || ''}\n${error.stderr || error.message}`, { cause: error });
  }
}, 130000);
