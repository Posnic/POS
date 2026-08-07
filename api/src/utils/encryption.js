const crypto = require('crypto');
const config = require('../config/config');

/**
 * Encryption utility that byte-for-byte matches the PHP implementation so that
 * receipt links generated/decoded here are interoperable with the legacy PHP API.
 *
 * PHP (setting_model.php:2674 encrypt, sales_model.php:6899 decrypt):
 *   $key = hash('sha256', $encryption_key);          // 64-char lowercase hex STRING
 *   $iv  = substr(hash('sha256', $encryption_iv),0,16);
 *   // encrypt: base64_encode( openssl_encrypt($data,'AES-256-CBC',$key,0,$iv) )  -> DOUBLE base64
 *   // decrypt: openssl_decrypt( base64_decode($id), 'AES-256-CBC',$key,0,$iv )
 *
 * Key nuance: PHP passes the 64-char hex STRING as the key; OpenSSL truncates it
 * to the first 32 BYTES (i.e. the first 32 hex characters, as ASCII) for AES-256.
 * openssl_encrypt/decrypt with options=0 base64-encode/decode internally, and the
 * outer base64_encode adds a second layer -> the id in the URL is double-base64.
 */
class Encryption {
  static _keyIv() {
    const keyHex = crypto.createHash('sha256').update(String(config.encryption.key)).digest('hex'); // 64 hex chars
    // OpenSSL uses the first 32 bytes of the (hex string) key for AES-256
    const key = Buffer.from(keyHex.substring(0, 32), 'utf8');

    const ivHex = crypto.createHash('sha256').update(String(config.encryption.iv)).digest('hex');
    const iv = Buffer.from(ivHex.substring(0, 16), 'utf8'); // 16 bytes

    return { key, iv };
  }

  /**
   * Encrypt a value into the same double-base64 form the PHP API produces.
   * @param {string} plainText
   * @returns {string} double-base64 encrypted id
   */
  static generateEncryptedId(plainText) {
    const { key, iv } = this._keyIv();
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    // Inner base64 == PHP openssl_encrypt(..., options=0)
    const inner = cipher.update(String(plainText), 'utf8', 'base64') + cipher.final('base64');
    // Outer base64 == PHP base64_encode(...)
    return Buffer.from(inner, 'utf8').toString('base64');
  }

  /**
   * Decrypt an id produced by generateEncryptedId (or the PHP API).
   * @param {string} encryptedText
   * @returns {string} decrypted plaintext (e.g. a Mongo ObjectId hex string)
   */
  static decryptId(encryptedText) {
    const { key, iv } = this._keyIv();
    // A base64 '+' becomes a space when the id travels through a URL query
    // string; restore it before decoding (PHP's urldecode + base64_decode is
    // lenient about this, Node's Buffer base64 is not).
    const normalized = String(encryptedText).replace(/ /g, '+').trim();
    // Undo the outer base64 -> inner base64 string
    const inner = Buffer.from(normalized, 'base64').toString('utf8');
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    // Inner is base64 (PHP openssl_decrypt with options=0 base64-decodes it)
    const decrypted = decipher.update(inner, 'base64', 'utf8') + decipher.final('utf8');
    return decrypted.trim();
  }
}

module.exports = Encryption;
