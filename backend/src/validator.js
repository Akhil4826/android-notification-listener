/**
 * Input validator and sanitizer for notification payloads.
 * Protects against oversized payloads and malformed inputs.
 */

const MAX_PAYLOAD_BYTES = 256 * 1024; // 256 KB
const MAX_TITLE_LENGTH = 300;
const MAX_TEXT_LENGTH = 2000;
const MAX_BIG_TEXT_LENGTH = 4000;
const MAX_APP_NAME_LENGTH = 100;
const MAX_PACKAGE_NAME_LENGTH = 200;

/**
 * Validate incoming raw body size and parse JSON safely.
 *
 * @param {string|Buffer} body - Raw HTTP body
 * @returns {{ valid: boolean, data?: any, error?: string, statusCode?: number }}
 */
function parseAndValidateBody(body) {
  if (!body) {
    return { valid: false, statusCode: 400, error: 'Empty request body.' };
  }

  const byteLength = Buffer.byteLength(typeof body === 'string' ? body : JSON.stringify(body));
  if (byteLength > MAX_PAYLOAD_BYTES) {
    return {
      valid: false,
      statusCode: 413,
      error: `Payload too large. Exceeds limit of ${MAX_PAYLOAD_BYTES / 1024} KB.`
    };
  }

  try {
    const data = typeof body === 'string' ? JSON.parse(body) : body;
    return { valid: true, data };
  } catch (err) {
    return { valid: false, statusCode: 400, error: 'Malformed JSON payload.' };
  }
}

/**
 * Normalize and sanitize a single notification object.
 *
 * @param {Object} raw - Raw notification object
 * @param {string} fallbackDeviceId - Device ID from headers or query
 * @returns {Object} Cleaned notification
 */
function sanitizeNotification(raw, fallbackDeviceId = '') {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid notification object.');
  }

  const notificationKey = String(raw.notificationKey || raw.key || '').trim();
  if (!notificationKey) {
    throw new Error('Missing required field: notificationKey or key.');
  }

  const deviceId = String(raw.deviceId || fallbackDeviceId || '').trim();
  if (!deviceId) {
    throw new Error('Missing required field: deviceId.');
  }

  const packageName = String(raw.packageName || '').slice(0, MAX_PACKAGE_NAME_LENGTH).trim();
  const appName = String(raw.appName || packageName || 'Unknown App').slice(0, MAX_APP_NAME_LENGTH).trim();
  const title = String(raw.title || '').slice(0, MAX_TITLE_LENGTH).trim();
  const text = String(raw.text || '').slice(0, MAX_TEXT_LENGTH).trim();
  const bigText = String(raw.bigText || '').slice(0, MAX_BIG_TEXT_LENGTH).trim();
  const subText = String(raw.subText || '').slice(0, 200).trim();
  const category = String(raw.category || '').slice(0, 50).trim();
  const postedAt = Number(raw.postedAt || raw.time || Date.now());
  const updatedAt = Number(raw.updatedAt || Date.now());
  const lastSeenAt = Number(raw.lastSeenAt || Date.now());
  const isActive = raw.isActive !== undefined ? Boolean(raw.isActive) : true;
  const isReadByAlexa = Boolean(raw.isReadByAlexa || false);
  const contentAvailable = Boolean(raw.contentAvailable !== undefined ? raw.contentAvailable : (title || text || bigText));
  const eventType = String(raw.eventType || (isActive ? 'POSTED' : 'REMOVED')).toUpperCase();
  const id = String(raw.id || `${deviceId}|${notificationKey}|${postedAt}`);

  return {
    id,
    notificationKey,
    deviceId,
    packageName,
    appName,
    title,
    text,
    subText,
    bigText,
    category,
    postedAt,
    updatedAt,
    lastSeenAt,
    isActive,
    isReadByAlexa,
    contentAvailable,
    eventType
  };
}

module.exports = {
  parseAndValidateBody,
  sanitizeNotification,
  MAX_PAYLOAD_BYTES
};
