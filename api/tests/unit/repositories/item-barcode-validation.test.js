const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

// The driver serializes Map-based handshake metadata. Run the real-database
// cases in Node's native realm, outside Jest's VM, as the production API does.
test('barcode creation, imports, variants and health checks against MongoDB', async () => {
  try {
    await promisify(execFile)(
      process.execPath,
      ['--test', path.join(__dirname, '../../fixtures/item-barcode-validation.cjs')],
      {
        timeout: 120000,
        maxBuffer: 2 * 1024 * 1024,
      }
    );
  } catch (error) {
    throw new Error(`${error.stdout || ''}\n${error.stderr || error.message}`, { cause: error });
  }
}, 130000);
