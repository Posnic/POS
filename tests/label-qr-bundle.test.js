const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const encoder = require('../api/node_modules/qrcode/lib/core/qrcode');

test('bundled label QR preserves the locked encoder output for multilingual and escaped input', () => {
    const context = { TextEncoder };
    vm.runInNewContext(fs.readFileSync('frontend/static/script/js/vendor/label-qr.js', 'utf8'), context);
    for (const value of ['1234567890', 'ITEM-ABC/12', 'Room 56', 'தமிழ்', '漢字かな', 'u3000\\u3000\\\\[.*+?]', '<script>"&\nLine 2']) {
        const expected = encoder.create(value, { errorCorrectionLevel: 'M' });
        const actual = context.PosnicLabelQR.create(value, { errorCorrectionLevel: 'M' });
        assert.equal(actual.modules.size, expected.modules.size, value);
        assert.deepEqual(Array.from(actual.modules.data), Array.from(expected.modules.data), value);
    }
});
