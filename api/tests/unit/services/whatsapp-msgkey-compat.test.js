const restore = require('../../../scripts/whatsapp-msgkey-compat.cjs');

test('new message keys resolve both sent-message and chat-history lookups', () => {
  class Key { toString() { return 'true_chat_message'; } }
  restore({ require: () => Key });
  const key = new Key();
  const messages = new Map([['true_chat_message', { text: 'test' }]]);
  expect(messages.get(key._serialized)).toEqual({ text: 'test' });
  key._serialized = 'legacy-key';
  expect(key._serialized).toBe('legacy-key');
  expect(JSON.parse(JSON.stringify(key))._serialized).toBe('legacy-key');
});

test('existing serialization getter remains unchanged and installation is idempotent', () => {
  class Key { get _serialized() { return 'existing'; } }
  const descriptor = Object.getOwnPropertyDescriptor(Key.prototype, '_serialized');
  restore({ require: () => Key });
  restore({ require: () => Key });
  expect(Object.getOwnPropertyDescriptor(Key.prototype, '_serialized')).toEqual(descriptor);
});
