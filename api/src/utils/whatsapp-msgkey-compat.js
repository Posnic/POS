'use strict';
/* global window */
// Compatibility strategy discussed upstream:
// https://github.com/wwebjs/whatsapp-web.js/pull/201901
module.exports = function restoreMessageKeySerialization(page = window) {
  const prototype = page.require('WAWebMsgKey').prototype;
  if (Object.getOwnPropertyDescriptor(prototype, '_serialized')) return;
  Object.defineProperty(prototype, '_serialized', {
    configurable: true,
    get() {
      return this.toString();
    },
    set(value) {
      Object.defineProperty(this, '_serialized', {
        value,
        writable: true,
        enumerable: true,
        configurable: true,
      });
    },
  });
};
