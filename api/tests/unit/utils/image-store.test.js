'use strict';
/*
 * Images have to survive three things this test suite pins down.
 *
 * One: a till and the web app render the SAME string and each resolves it
 * against its own origin. The moment an absolute URL is written to a document
 * that stops being true - which is the bug that is already in live data, as
 * rows holding http://localhost:5000/uploads/x.jpg that point at the reader's
 * own machine.
 *
 * Two: the rows already out there keep working. Full URLs and flat filenames
 * are not being rewritten, so resolve() has to keep understanding them for as
 * long as they exist.
 *
 * Three: the key reaches the filesystem, so nothing that is not a key this
 * module could itself have minted may get near it.
 */

const store = require('../../../src/utils/image-store');

const TENANT = '507f1f77bcf86cd799439011';
const bytes = Buffer.from('pretend this is a jpeg');

describe('image keys', () => {
  test('a cloud image is keyed by its tenant', () => {
    const key = store.keyFor({ tenantId: TENANT, kind: 'items', buffer: bytes, mimeType: 'image/jpeg' });
    expect(key.startsWith(`${TENANT}/items/`)).toBe(true);
    expect(store.isValidKey(key)).toBe(true);
  });

  test('a till has no tenant and keys under local', () => {
    const key = store.keyFor({ tenantId: null, kind: 'items', buffer: bytes, mimeType: 'image/png' });
    expect(key.startsWith('local/items/')).toBe(true);
    expect(store.isValidKey(key)).toBe(true);
  });

  test('the same bytes always produce the same key', () => {
    /* What makes a retry after a dropped connection a no-op rather than a
       duplicate, and what dedupes the same photo uploaded twice. */
    const a = store.keyFor({ tenantId: TENANT, kind: 'items', buffer: bytes, mimeType: 'image/jpeg' });
    const b = store.keyFor({ tenantId: TENANT, kind: 'items', buffer: bytes, mimeType: 'image/jpeg' });
    expect(a).toBe(b);
  });

  test('different bytes produce different keys', () => {
    const a = store.keyFor({ tenantId: TENANT, kind: 'items', buffer: bytes, mimeType: 'image/jpeg' });
    const b = store.keyFor({ tenantId: TENANT, kind: 'items', buffer: Buffer.from('other'), mimeType: 'image/jpeg' });
    expect(a).not.toBe(b);
  });

  test('two tenants never share a path for identical bytes', () => {
    /* The whole of the isolation between one shop's images and another's. */
    const other = '507f1f77bcf86cd799439012';
    const a = store.keyFor({ tenantId: TENANT, kind: 'items', buffer: bytes, mimeType: 'image/jpeg' });
    const b = store.keyFor({ tenantId: other, kind: 'items', buffer: bytes, mimeType: 'image/jpeg' });
    expect(a).not.toBe(b);
  });

  test('a malformed tenant is refused rather than guessed at', () => {
    /* Falling back to "local" here would file one shop's images under a path
       another shop can read. */
    expect(() =>
      store.keyFor({ tenantId: '../../etc', kind: 'items', buffer: bytes, mimeType: 'image/jpeg' })
    ).toThrow();
  });

  test('non-images are refused', () => {
    expect(() =>
      store.keyFor({ tenantId: TENANT, kind: 'items', buffer: bytes, mimeType: 'application/pdf' })
    ).toThrow();
  });
});

describe('resolving what is stored on a document', () => {
  test('a key becomes a relative path, so both apps can render it', () => {
    const key = store.keyFor({ tenantId: TENANT, kind: 'items', buffer: bytes, mimeType: 'image/jpeg' });
    const url = store.resolve(key);
    expect(url).toBe(`/uploads/${key}`);
    /* Relative is the entire point - an absolute URL would be correct on
       exactly one origin. */
    expect(url.startsWith('/')).toBe(true);
    expect(url).not.toMatch(/^https?:/);
  });

  test('a localhost URL loses its origin and keeps its path', () => {
    /* The shape already in live data. On the cloud it points the browser at
       the customer's own computer. */
    expect(store.resolve('http://localhost:5000/uploads/item-1699887-482910.jpg')).toBe(
      '/uploads/item-1699887-482910.jpg'
    );
    expect(store.resolve('http://127.0.0.1:3000/uploads/x.png')).toBe('/uploads/x.png');
  });

  test('an old flat filename still resolves', () => {
    expect(store.resolve('item-1699887-482910.jpg')).toBe('/uploads/item-1699887-482910.jpg');
  });

  test('an already-relative path is left alone', () => {
    expect(store.resolve('/uploads/item-1.jpg')).toBe('/uploads/item-1.jpg');
  });

  test('a real remote origin is never reinterpreted', () => {
    /* A CDN or S3 URL belongs to somebody else's origin and is not ours to
       rewrite - unlike loopback, which is only ever wrong. */
    const cdn = 'https://cdn.example.com/a/b.png';
    expect(store.resolve(cdn)).toBe(cdn);
    const s3 = 'https://some-bucket.s3.ap-south-1.amazonaws.com/x.jpg';
    expect(store.resolve(s3)).toBe(s3);
  });

  test('junk renders nothing rather than a broken location', () => {
    for (const v of ['', null, undefined, '../../etc/passwd', 'not a url at all', {}]) {
      expect(store.resolve(v)).toBe('');
    }
  });
});

describe('nothing unsafe reaches the filesystem', () => {
  test('traversal is refused by the key check', () => {
    expect(store.isValidKey('../../../etc/passwd')).toBe(false);
    expect(store.isValidKey(`${TENANT}/items/../../../etc/passwd`)).toBe(false);
    expect(store.isValidKey('local/items/../x.jpg')).toBe(false);
  });

  test('localPathFor refuses anything that is not a well-formed key', () => {
    /* Validating against the expected shape rather than stripping dangerous
       parts out - there is no way to be sure the stripping was complete. */
    expect(store.localPathFor('../../etc/passwd')).toBeNull();
    expect(store.localPathFor('')).toBeNull();
    expect(store.localPathFor(null)).toBeNull();
  });

  test('a legacy filename may not contain a directory separator', () => {
    expect(store.isLegacyFile('../x.jpg')).toBe(false);
    expect(store.isLegacyFile('a/b.jpg')).toBe(false);
    expect(store.isLegacyFile('item-1.jpg')).toBe(true);
  });

  test('only image extensions are accepted as legacy files', () => {
    expect(store.isLegacyFile('payload.js')).toBe(false);
    expect(store.isLegacyFile('x.html')).toBe(false);
  });
});
