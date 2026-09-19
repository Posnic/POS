'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');
const express = require('express');
const mockSend = jest.fn();
let mockDir;

jest.mock('../../../src/utils/s3', () => ({ getS3Client: () => ({ send: mockSend }) }));
jest.mock('../../../src/utils/image-store', () => {
  const actual = jest.requireActual('../../../src/utils/image-store');
  return {
    ...actual,
    get UPLOAD_DIR() {
      return mockDir;
    },
    localPathFor: (key) => (actual.isValidKey(key) ? require('path').join(mockDir, key) : null),
    saveLocal: async (key, bytes) => {
      const dest = require('path').join(mockDir, key);
      await require('fs/promises').mkdir(require('path').dirname(dest), { recursive: true });
      await require('fs/promises').writeFile(dest, bytes);
    },
  };
});

const router = require('../../../src/routes/uploads.route');
const app = express();
app.use('/uploads', router);
let server, origin;
beforeAll(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  origin = 'http://127.0.0.1:' + server.address().port;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});
async function get(url, status = 200) {
  const res = await fetch(origin + url);
  const body = Buffer.from(await res.arrayBuffer());
  expect(res.status).toBe(status);
  return { body, headers: Object.fromEntries(res.headers) };
}
const bytes = Buffer.from('test image bytes');
const previousBucket = process.env.AWS_S3_BUCKET;

beforeEach(() => {
  mockDir = fs.mkdtempSync(path.join(os.tmpdir(), 'posnic-image-recovery-'));
  process.env.AWS_S3_BUCKET = 'test-images';
  mockSend.mockReset().mockImplementation(async () => ({ Body: Readable.from([bytes]) }));
});
afterEach(() => {
  jest.restoreAllMocks();
  fs.rmSync(mockDir, { recursive: true, force: true });
  if (previousBucket === undefined) delete process.env.AWS_S3_BUCKET;
  else process.env.AWS_S3_BUCKET = previousBucket;
});

test('legacy product images recover from their flat S3 key and are cached at the requested path', async () => {
  const url = '/uploads/item_images/2026-09-19-posnic_item_image-example.jpg';
  const first = await get(url);
  expect(first.body).toEqual(bytes);
  expect(mockSend.mock.calls[0][0].input).toEqual({
    Bucket: 'test-images',
    Key: path.basename(url),
  });
  expect(fs.readFileSync(path.join(mockDir, url.slice(9)))).toEqual(bytes);
  mockSend.mockRejectedValue(new Error('offline'));
  await get(url);
  expect(mockSend).toHaveBeenCalledTimes(1);
  expect(first.headers['cache-control']).not.toContain('immutable');
});

test.each(['file-example.png', 'demo/retail/example.jpg', 'file-example.gif', 'file-example.bmp'])(
  'legacy image %s retains its S3 namespace',
  async (key) => {
    const result = await get('/uploads/' + key);
    expect(mockSend.mock.calls[0][0].input.Key).toBe(key);
    expect(result.headers['content-type']).toMatch(/^image\//);
  }
);

test('content-addressed keys retain their tenant namespace and immutable caching', async () => {
  const key = '507f1f77bcf86cd799439011/items/' + 'a'.repeat(64) + '.png';
  const result = await get('/uploads/' + key);
  expect(mockSend.mock.calls[0][0].input.Key).toBe(key);
  expect(result.headers['cache-control']).toContain('immutable');
});

test('missing and denied objects return uncached 404s and a later successful request retries', async () => {
  mockSend.mockRejectedValueOnce(new Error('AccessDenied'));
  const url = '/uploads/item_images/missing.jpg';
  const miss = await get(url, 404);
  expect(miss.headers['cache-control']).toBe('no-store');
  await get(url);
  expect(mockSend).toHaveBeenCalledTimes(2);
});

test('a disk cache failure still returns the original image bytes', async () => {
  jest.spyOn(fs.promises, 'mkdir').mockRejectedValueOnce(new Error('read only'));
  const result = await get('/uploads/item_images/photo.jpg');
  expect(result.body).toEqual(bytes);
});

test('malformed paths and non-image files never reach S3', async () => {
  for (const url of [
    '/uploads/%2e%2e%2fprivate.jpg',
    '/uploads/a%5csecret.png',
    '/uploads/file.svg',
    '/uploads/file.html',
  ]) {
    await get(url, 404);
  }
  expect(mockSend).not.toHaveBeenCalled();
});
