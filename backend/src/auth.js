/**
 * Authentication and authorization handler for Phone Reader backend.
 * Provides secure token verification and device isolation.
 */

const crypto = require('crypto');

/**
 * Validate incoming request authorization.
 * Supports:
 * 1. Bearer token in 'Authorization' header: "Bearer <token>"
 * 2. Token in 'x-api-key' header
 * 3. Compares with process.env.API_TOKEN (or process.env.DEVICE_TOKEN)
 *
 * @param {Object} headers - Request headers (normalized to lowercase)
 * @param {string} claimedDeviceId - Device ID in path, query, or body
 * @returns {{ authorized: boolean, error?: string, statusCode?: number }}
 */
function verifyRequest(headers = {}, claimedDeviceId = '') {
  const configuredToken = process.env.API_TOKEN || process.env.DEVICE_TOKEN;

  if (!configuredToken) {
    // If no token is configured in environment, reject for safety in production
    if (process.env.NODE_ENV === 'test') {
      return { authorized: true };
    }
    return {
      authorized: false,
      statusCode: 500,
      error: 'Backend security configuration missing: API_TOKEN is not set.'
    };
  }

  // Find auth header (case-insensitive)
  const authHeader = headers['authorization'] || headers['Authorization'] || '';
  const apiKeyHeader = headers['x-api-key'] || headers['X-Api-Key'] || '';

  let providedToken = '';
  if (authHeader.startsWith('Bearer ')) {
    providedToken = authHeader.substring(7).trim();
  } else if (apiKeyHeader) {
    providedToken = apiKeyHeader.trim();
  }

  if (!providedToken) {
    return {
      authorized: false,
      statusCode: 401,
      error: 'Unauthorized: Missing Authorization header with Bearer token.'
    };
  }

  // Constant-time comparison to prevent timing attacks
  const isMatch = safeCompare(providedToken, configuredToken);
  if (!isMatch) {
    return {
      authorized: false,
      statusCode: 403,
      error: 'Forbidden: Invalid authorization token.'
    };
  }

  // Validate device isolation if deviceId is provided in header
  const headerDeviceId = headers['x-device-id'] || headers['X-Device-Id'];
  if (headerDeviceId && claimedDeviceId && headerDeviceId !== claimedDeviceId) {
    return {
      authorized: false,
      statusCode: 403,
      error: 'Forbidden: Device ID mismatch between headers and request payload.'
    };
  }

  return { authorized: true };
}

/**
 * Perform a constant-time string comparison to mitigate timing attacks.
 */
function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

module.exports = {
  verifyRequest,
  safeCompare
};
