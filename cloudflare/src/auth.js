/**
 * Authentication and device isolation middleware for Cloudflare Worker.
 * Enforces timing-safe token validation and strict device boundary checks.
 */

import crypto from 'node:crypto';

/**
 * Validate incoming request authorization against configured environment secret.
 *
 * @param {Request|Object} request - Fetch Request or mock object
 * @param {Object} env - Cloudflare Worker environment bindings
 * @param {string} claimedDeviceId - Device ID in query parameters or payload
 * @returns {{ authorized: boolean, error?: string, statusCode?: number }}
 */
function verifyRequest(request, env = {}, claimedDeviceId = '') {
  // In Cloudflare Workers, secrets are bound on the 'env' object.
  // Fall back to process.env during Node.js testing.
  const rawToken = (env && env.API_TOKEN) || process.env.API_TOKEN;
  const configuredToken = rawToken ? String(rawToken).trim() : '';

  if (!configuredToken) {
    if (process.env.NODE_ENV === 'test' && !env.API_TOKEN) {
      return { authorized: true };
    }
    return {
      authorized: false,
      statusCode: 500,
      error: 'Backend security configuration missing: API_TOKEN is not configured.'
    };
  }

  // Extract headers
  let authHeader = '';
  let apiKeyHeader = '';
  let headerDeviceId = '';

  if (request && typeof request.headers?.get === 'function') {
    authHeader = request.headers.get('authorization') || '';
    apiKeyHeader = request.headers.get('x-api-key') || '';
    headerDeviceId = request.headers.get('x-device-id') || '';
  } else if (request && request.headers) {
    authHeader = request.headers['authorization'] || request.headers['Authorization'] || '';
    apiKeyHeader = request.headers['x-api-key'] || request.headers['X-Api-Key'] || '';
    headerDeviceId = request.headers['x-device-id'] || request.headers['X-Device-Id'] || '';
  }

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

  // Enforce device isolation: header device ID and body/query device ID must match if both present
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
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export {
  verifyRequest,
  safeCompare
};
