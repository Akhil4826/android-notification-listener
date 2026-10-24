/**
 * Main AWS Lambda handler for Phone Reader API Gateway endpoints.
 * Handles notification events, active notification sync, and Alexa queries.
 */

const { verifyRequest } = require('./auth');
const { parseAndValidateBody, sanitizeNotification } = require('./validator');
const db = require('./db');

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Device-Id, X-Api-Key',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS'
};

function jsonResponse(statusCode, data) {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(data)
  };
}

/**
 * Standard Lambda HTTP Event Handler.
 */
async function handler(event, context) {
  // Normalize method and path (compatible with both REST API and HTTP API v2)
  const httpMethod = (event.httpMethod || (event.requestContext && event.requestContext.http && event.requestContext.http.method) || 'GET').toUpperCase();
  const rawPath = event.path || (event.requestContext && event.requestContext.http && event.requestContext.http.path) || '/';
  const path = rawPath.replace(/^\/[a-zA-Z0-9_-]+(?=\/api)/, ''); // Remove API Gateway stage prefix if present
  const headers = event.headers || {};
  const queryParams = event.queryStringParameters || {};

  // Handle CORS preflight
  if (httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: CORS_HEADERS,
      body: ''
    };
  }

  // Health check endpoint (public, unauthenticated, safe)
  if (path === '/api/health' && httpMethod === 'GET') {
    return jsonResponse(200, {
      status: 'ok',
      service: 'phone-reader-backend',
      timestamp: Date.now()
    });
  }

  // Extract claimed deviceId from query, headers, or body
  const headerDeviceId = headers['x-device-id'] || headers['X-Device-Id'] || queryParams.deviceId || '';

  // Authenticate request
  const authResult = verifyRequest(headers, headerDeviceId);
  if (!authResult.authorized) {
    return jsonResponse(authResult.statusCode || 401, {
      error: authResult.error || 'Unauthorized'
    });
  }

  try {
    // Route: POST /api/notifications
    // Ingests either a single notification event or a batch
    if (path === '/api/notifications' && httpMethod === 'POST') {
      const parsed = parseAndValidateBody(event.body);
      if (!parsed.valid) {
        return jsonResponse(parsed.statusCode, { error: parsed.error });
      }

      const body = parsed.data;

      // Case 1: Batch sync payload
      if (Array.isArray(body.notifications)) {
        const deviceId = body.deviceId || headerDeviceId;
        if (!deviceId) {
          return jsonResponse(400, { error: 'Missing deviceId in batch payload.' });
        }
        const cleanedList = body.notifications.map(n => sanitizeNotification(n, deviceId));
        const saved = await db.batchUpsertNotifications(deviceId, cleanedList, Boolean(body.isFullActiveSync));

        return jsonResponse(200, {
          success: true,
          count: saved.length,
          isFullActiveSync: Boolean(body.isFullActiveSync),
          message: `Processed ${saved.length} notifications.`
        });
      }

      // Case 2: Single notification event
      const deviceId = body.deviceId || headerDeviceId;
      const cleaned = sanitizeNotification(body, deviceId);
      const saved = await db.upsertNotification(cleaned);

      return jsonResponse(200, {
        success: true,
        id: saved.id,
        notificationKey: saved.notificationKey,
        isActive: saved.isActive,
        eventType: saved.eventType,
        message: 'Notification saved successfully.'
      });
    }

    // Route: GET /api/notifications/active
    // Returns list of currently active notifications for device
    if (path === '/api/notifications/active' && httpMethod === 'GET') {
      const deviceId = queryParams.deviceId || headerDeviceId;
      if (!deviceId) {
        return jsonResponse(400, { error: 'Missing required query parameter: deviceId.' });
      }

      const appFilter = queryParams.app || '';
      const limit = queryParams.limit ? parseInt(queryParams.limit, 10) : 25;
      const notifications = await db.getActiveNotifications(deviceId, { appFilter, limit });

      return jsonResponse(200, {
        success: true,
        deviceId,
        count: notifications.length,
        notifications
      });
    }

    // Route: GET /api/notifications/latest
    // Returns single newest active notification for device
    if (path === '/api/notifications/latest' && httpMethod === 'GET') {
      const deviceId = queryParams.deviceId || headerDeviceId;
      if (!deviceId) {
        return jsonResponse(400, { error: 'Missing required query parameter: deviceId.' });
      }

      const appFilter = queryParams.app || '';
      const notification = await db.getLatestNotification(deviceId, { appFilter });

      return jsonResponse(200, {
        success: true,
        deviceId,
        hasNotification: notification !== null,
        notification
      });
    }

    // Route: POST /api/notifications/ack
    // Marks notifications as read
    if (path === '/api/notifications/ack' && httpMethod === 'POST') {
      const parsed = parseAndValidateBody(event.body);
      if (!parsed.valid) {
        return jsonResponse(parsed.statusCode, { error: parsed.error });
      }

      const deviceId = parsed.data.deviceId || headerDeviceId;
      const keys = parsed.data.notificationKeys || [];
      const updatedCount = await db.acknowledgeNotifications(deviceId, keys);

      return jsonResponse(200, {
        success: true,
        acknowledgedCount: updatedCount
      });
    }

    // Route: DELETE /api/notifications
    // Clears stored notifications for privacy/reset
    if (path === '/api/notifications' && httpMethod === 'DELETE') {
      const deviceId = queryParams.deviceId || headerDeviceId;
      if (!deviceId) {
        return jsonResponse(400, { error: 'Missing required query parameter: deviceId.' });
      }

      const deletedCount = await db.clearDeviceData(deviceId);
      return jsonResponse(200, {
        success: true,
        deletedCount,
        message: 'Device notifications cleared.'
      });
    }

    // Route Not Found
    return jsonResponse(404, {
      error: `Not Found: ${httpMethod} ${path}`
    });

  } catch (err) {
    // Avoid logging sensitive message text or tokens
    console.error('API Error processing request:', err.message);
    return jsonResponse(500, {
      error: 'Internal server error processing request.'
    });
  }
}

module.exports = {
  handler
};
