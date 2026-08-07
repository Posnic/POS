const { ObjectId } = require('mongodb');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const stream = require('stream');

const pipeline = promisify(stream.pipeline);

/**
 * Format date to a readable string
 * @param {Date|string|number} date - Date to format
 * @param {Object} options - Formatting options
 * @returns {string|null} Formatted date string or null if invalid
 */
const formatDate = (date, options = {}) => {
  if (!date) return '';

  try {
    let d;

    // Handle Date object
    if (date instanceof Date) {
      d = date;
    }
    // Handle timestamp number
    else if (typeof date === 'number') {
      d = new Date(date);
    }
    // Handle ISO string
    else if (typeof date === 'string') {
      d = new Date(date);
    }
    // Handle MongoDB BSON format
    else if (typeof date === 'object' && date !== null) {
      // Check for MongoDB Extended JSON format
      if (date.$date) {
        if (typeof date.$date === 'object' && date.$date.$numberLong) {
          // Format: { $date: { $numberLong: "1772169120000" } }
          d = new Date(parseInt(date.$date.$numberLong, 10));
        } else if (typeof date.$date === 'string') {
          // Format: { $date: "2026-01-15T10:30:00.000Z" }
          d = new Date(date.$date);
        } else if (typeof date.$date === 'number') {
          d = new Date(date.$date);
        }
      }
    }

    if (!d || isNaN(d.getTime())) {
      return '';
    }

    // Format as: MM/DD/YYYY hh:mm am/pm (matching PHP format)
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const year = d.getFullYear();

    let hours = d.getHours();
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const ampm = hours >= 12 ? 'pm' : 'am';

    hours = hours % 12;
    hours = hours ? hours : 12;
    const hoursStr = String(hours).padStart(2, '0');

    return `${month}/${day}/${year} ${hoursStr}:${minutes} ${ampm}`;
  } catch (error) {
    console.error('Error in formatDate:', error);
    return '';
  }
};

/**
 * Check if a string is a valid MongoDB ObjectId
 * @param {string} id - The ID to validate
 * @returns {boolean} True if valid, false otherwise
 */
const isValidObjectId = (id) => {
  if (!id || typeof id !== 'string') return false;
  try {
    return new ObjectId(id).toString() === id;
  } catch (e) {
    return false;
  }
};

/**
 * Convert a string to MongoDB ObjectId
 * @param {string} id - The ID to convert
 * @returns {ObjectId|null} ObjectId instance or null if invalid
 */
const toObjectId = (id) => {
  if (!id) return null;
  try {
    return new ObjectId(id);
  } catch (e) {
    return null;
  }
};

/**
 * Generate a random string of specified length
 * @param {number} length - Length of the random string
 * @returns {string} Random string
 */
const generateRandomString = (length = 32) => {
  return crypto
    .randomBytes(Math.ceil(length / 2))
    .toString('hex')
    .slice(0, length);
};

/**
 * Generate a hash from a string
 * @param {string} data - Data to hash
 * @param {string} algorithm - Hash algorithm (default: sha256)
 * @returns {string} Hashed string
 */
const generateHash = (data, algorithm = 'sha256') => {
  return crypto.createHash(algorithm).update(data).digest('hex');
};

/**
 * Generate a secure random token
 * @param {number} bytes - Number of random bytes
 * @returns {Promise<string>} Random token
 */
const generateToken = (bytes = 32) => {
  return new Promise((resolve, reject) => {
    crypto.randomBytes(bytes, (err, buf) => {
      if (err) return reject(err);
      resolve(buf.toString('hex'));
    });
  });
};

/**
 * Validate email format
 * @param {string} email - Email to validate
 * @returns {boolean} True if valid, false otherwise
 */
const isValidEmail = (email) => {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(String(email).toLowerCase());
};

/**
 * Validate phone number format
 * @param {string} phone - Phone number to validate
 * @returns {boolean} True if valid, false otherwise
 */
const isValidPhone = (phone) => {
  const re = /^\+?[\d\s-()]{10,}$/;
  return re.test(phone);
};

/**
 * Convert file size to human readable format
 * @param {number} bytes - File size in bytes
 * @param {number} decimals - Number of decimal places
 * @returns {string} Formatted file size
 */
const formatFileSize = (bytes, decimals = 2) => {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
};

/**
 * Ensure directory exists, create if it doesn't
 * @param {string} dirPath - Directory path
 * @returns {Promise<void>}
 */
const ensureDirectoryExists = async (dirPath) => {
  try {
    await fs.promises.mkdir(dirPath, { recursive: true });
  } catch (error) {
    if (error.code !== 'EEXIST') {
      throw error;
    }
  }
};

/**
 * Save file to disk with proper error handling
 * @param {string} filePath - Destination file path
 * @param {Buffer|Stream} data - File data
 * @returns {Promise<void>}
 */
const saveFile = async (filePath, data) => {
  try {
    await ensureDirectoryExists(path.dirname(filePath));

    if (data instanceof stream.Readable) {
      const writeStream = fs.createWriteStream(filePath);
      await pipeline(data, writeStream);
    } else {
      await fs.promises.writeFile(filePath, data);
    }
  } catch (error) {
    throw new Error(`Failed to save file: ${error.message}`, { cause: error });
  }
};

/**
 * Parse JSON safely
 * @param {string} jsonString - JSON string to parse
 * @param {*} defaultValue - Default value if parsing fails
 * @returns {*} Parsed JSON or default value
 */
const safeJsonParse = (jsonString, defaultValue = {}) => {
  try {
    return JSON.parse(jsonString);
  } catch (e) {
    return defaultValue;
  }
};

/**
 * Convert object to query string
 * @param {Object} obj - Object to convert
 * @returns {string} Query string
 */
const toQueryString = (obj) => {
  return Object.entries(obj)
    .filter(([_, value]) => value !== undefined && value !== null)
    .map(([key, value]) => {
      if (Array.isArray(value)) {
        return value
          .filter((v) => v !== undefined && v !== null)
          .map((v) => `${encodeURIComponent(key)}=${encodeURIComponent(v)}`)
          .join('&');
      }
      return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
    })
    .join('&');
};

/**
 * Deep clone an object
 * @param {Object} obj - Object to clone
 * @returns {Object} Cloned object
 */
const deepClone = (obj) => {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (obj instanceof Date) {
    return new Date(obj);
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => deepClone(item));
  }

  const cloned = {};
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      cloned[key] = deepClone(obj[key]);
    }
  }

  return cloned;
};

module.exports = {
  formatDate,
  isValidObjectId,
  toObjectId,
  generateRandomString,
  generateHash,
  generateToken,
  isValidEmail,
  isValidPhone,
  formatFileSize,
  ensureDirectoryExists,
  saveFile,
  safeJsonParse,
  toQueryString,
  deepClone,
};
