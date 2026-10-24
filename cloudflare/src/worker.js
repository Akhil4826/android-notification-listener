/**
 * Main Cloudflare Worker entry point for Personal Phone Reader.
 * Implements standard Fetch handler with D1 database bindings.
 */

import { verifyRequest } from './auth.js';
import { parseAndValidateBody, sanitizeNotification } from './validator.js';
import d1 from './d1.js';

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Device-Id, X-Api-Key',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS'
};

function jsonResponse(statusCode, data) {
  return new Response(JSON.stringify(data), {
    status: statusCode,
    headers: CORS_HEADERS
  });
}

/**
 * Broadcast device action via real-time WebSocket topic on ntfy.sh (100% Free / $0.00).
 * Device listens on wss://ntfy.sh/pr_act_<cleanDeviceId>/ws
 */
async function broadcastActionRealtime(deviceId, action) {
  try {
    const cleanId = (deviceId || '').replace(/[^a-zA-Z0-9]/g, '');
    if (!cleanId) return;
    const topic = `pr_act_${cleanId}`;
    await fetch(`https://ntfy.sh/${topic}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Title': 'Phone Reader Action'
      },
      body: JSON.stringify(action),
      signal: AbortSignal.timeout(3500)
    });
  } catch (err) {
    // Non-blocking fallback to D1 polling
  }
}

function triggerRealtimeBroadcast(ctx, deviceId, action) {
  const promise = broadcastActionRealtime(deviceId, action);
  if (ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(promise);
  } else {
    promise.catch(() => {});
  }
}

/**
 * Handle incoming HTTP requests at the Cloudflare Edge.
 */
async function handleRequest(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = request.method.toUpperCase();

  // Handle CORS preflight
  if (method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: CORS_HEADERS
    });
  }

  // Health check endpoint (public, unauthenticated, safe)
  if ((path === '/api/health' || path === '/health') && method === 'GET') {
    return jsonResponse(200, {
      status: 'ok',
      service: 'phone-reader-cloudflare-worker',
      timestamp: Date.now()
    });
  }

  // Extract claimed deviceId from query, headers, or body
  const headerDeviceId = request.headers.get('x-device-id') || '';
  const queryDeviceId = url.searchParams.get('deviceId') || '';
  const claimedDeviceId = queryDeviceId || headerDeviceId;

  // Authenticate request against configured API_TOKEN
  const authResult = verifyRequest(request, env, claimedDeviceId);
  if (!authResult.authorized) {
    return jsonResponse(authResult.statusCode || 401, {
      error: authResult.error || 'Unauthorized'
    });
  }

  const db = env.DB;
  if (!db) {
    return jsonResponse(500, {
      error: 'D1 database binding (env.DB) is not configured.'
    });
  }

  try {
    const isIngestPath = (path === '/api/notifications' || path === '/' || path === '/api' || path === '/notifications');
    const isActivePath = (path === '/api/notifications/active' || path === '/active' || path === '/api/active');
    const isLatestPath = (path === '/api/notifications/latest' || path === '/latest' || path === '/api/latest');
    const isCountPath = (path === '/api/notifications/count' || path === '/count' || path === '/api/count');
    const isAckPath = (path === '/api/notifications/ack' || path === '/ack' || path === '/api/ack');
    const isSettingsPath = (path === '/api/settings' || path === '/settings');
    const isStatusPath = (path === '/api/status' || path === '/status');
    const isQuotaPath = (path === '/api/quota' || path === '/quota' || path === '/api/stats');

    // Route: POST notifications (Single or Batch Ingestion)
    if (isIngestPath && method === 'POST') {
      const rawText = await request.text();
      const parsed = parseAndValidateBody(rawText);
      if (!parsed.valid) {
        return jsonResponse(parsed.statusCode, { error: parsed.error });
      }

      const body = parsed.data;

      // Opportunistic automatic pruning of old and dismissed notifications to prevent storage bloat
      try {
        await d1.pruneOldNotifications(db, Number(env.RETENTION_DAYS || 7));
      } catch (e) {
        // Non-blocking prune error
      }

      // Case 1: Batch sync payload
      if (Array.isArray(body.notifications)) {
        const deviceId = body.deviceId || claimedDeviceId;
        if (!deviceId) {
          return jsonResponse(400, { error: 'Missing deviceId in batch payload.' });
        }
        const cleanedList = body.notifications.map(n => sanitizeNotification(n, deviceId));
        const isFullActiveSync = Boolean(body.isFullActiveSync);
        const saved = await d1.batchUpsertNotifications(db, deviceId, cleanedList, isFullActiveSync);

        return jsonResponse(200, {
          success: true,
          count: saved.length,
          isFullActiveSync,
          message: `Processed ${saved.length} notifications.`
        });
      }

      // Case 2: Single notification event
      const deviceId = body.deviceId || claimedDeviceId;
      const cleaned = sanitizeNotification(body, deviceId);
      const saved = await d1.upsertNotification(db, cleaned);

      return jsonResponse(200, {
        success: true,
        notificationKey: saved.notificationKey,
        isActive: saved.isActive,
        eventType: saved.eventType,
        message: 'Notification saved successfully.'
      });
    }

    // Route: GET active notifications (with optional app and sender filters)
    if (isActivePath && method === 'GET') {
      const deviceId = queryDeviceId || headerDeviceId;
      if (!deviceId) {
        return jsonResponse(400, { error: 'Missing required query parameter: deviceId.' });
      }

      const appFilter = url.searchParams.get('app') || '';
      const sender = url.searchParams.get('sender') || '';
      const limit = url.searchParams.get('limit') ? parseInt(url.searchParams.get('limit'), 10) : 25;
      const notifications = await d1.getActiveNotifications(db, deviceId, { appFilter, sender, limit });

      return jsonResponse(200, {
        success: true,
        deviceId,
        count: notifications.length,
        notifications
      });
    }

    // Route: GET latest notification
    if (isLatestPath && method === 'GET') {
      const deviceId = queryDeviceId || headerDeviceId;
      if (!deviceId) {
        return jsonResponse(400, { error: 'Missing required query parameter: deviceId.' });
      }

      const appFilter = url.searchParams.get('app') || '';
      const notification = await d1.getLatestNotification(db, deviceId, { appFilter });

      return jsonResponse(200, {
        success: true,
        deviceId,
        hasNotification: notification !== null,
        notification
      });
    }

    // Route: GET count of notifications
    if (isCountPath && method === 'GET') {
      const deviceId = queryDeviceId || headerDeviceId;
      if (!deviceId) {
        return jsonResponse(400, { error: 'Missing required query parameter: deviceId.' });
      }

      const countResult = await d1.countNotifications(db, deviceId);

      return jsonResponse(200, {
        success: true,
        deviceId,
        total: countResult.total,
        byApp: countResult.byApp
      });
    }

    // Route: POST ack notifications
    if (isAckPath && method === 'POST') {
      const rawText = await request.text();
      const parsed = parseAndValidateBody(rawText);
      if (!parsed.valid) {
        return jsonResponse(parsed.statusCode, { error: parsed.error });
      }

      const deviceId = parsed.data.deviceId || claimedDeviceId;
      const keys = parsed.data.notificationKeys || [];
      const updatedCount = await d1.acknowledgeNotifications(db, deviceId, keys);

      return jsonResponse(200, {
        success: true,
        acknowledgedCount: updatedCount
      });
    }

    // Route: DELETE notifications (all or specific app)
    if (isIngestPath && method === 'DELETE') {
      const deviceId = queryDeviceId || headerDeviceId;
      if (!deviceId) {
        return jsonResponse(400, { error: 'Missing required query parameter: deviceId.' });
      }

      const appFilter = url.searchParams.get('app') || '';
      const deletedCount = await d1.clearDeviceData(db, deviceId, { appFilter });
      return jsonResponse(200, {
        success: true,
        deletedCount,
        appFilter: appFilter || null,
        message: appFilter ? `Notifications for ${appFilter} cleared.` : 'Device notifications cleared.'
      });
    }

    // Route: GET phone status & sync heartbeat
    if (isStatusPath && method === 'GET') {
      const deviceId = queryDeviceId || headerDeviceId;
      if (!deviceId) {
        return jsonResponse(400, { error: 'Missing required query parameter: deviceId.' });
      }

      const status = await d1.getDeviceStatus(db, deviceId);
      return jsonResponse(200, {
        success: true,
        deviceId,
        status
      });
    }

    // Route: POST phone status (Android client reporting battery, charging, and ringer mode)
    if (isStatusPath && method === 'POST') {
      const rawText = await request.text();
      let body = {};
      try {
        body = JSON.parse(rawText || '{}');
      } catch (e) {
        return jsonResponse(400, { error: 'Invalid JSON payload in status update.' });
      }

      const deviceId = body.deviceId || queryDeviceId || headerDeviceId;
      if (!deviceId) {
        return jsonResponse(400, { error: 'Missing required deviceId.' });
      }

      const updatedStatus = await d1.upsertDeviceStatus(db, deviceId, body);
      return jsonResponse(200, {
        success: true,
        deviceId,
        status: updatedStatus
      });
    }

    // Route: GET quota metrics (for Quota Dashboard)
    if (isQuotaPath && method === 'GET') {
      const deviceId = queryDeviceId || headerDeviceId;
      if (!deviceId) {
        return jsonResponse(400, { error: 'Missing required query parameter: deviceId.' });
      }

      const quota = await d1.getQuotaMetrics(db, deviceId);
      return jsonResponse(200, quota);
    }

    // Route: POST verify secret key
    if (path === '/api/settings/secret-key/verify' && method === 'POST') {
      const rawText = await request.text();
      let body = {};
      try { body = JSON.parse(rawText || '{}'); } catch (e) {}

      const deviceId = body.deviceId || queryDeviceId || headerDeviceId;
      const key = body.key || body.secretKey || '';
      if (!deviceId) return jsonResponse(400, { error: 'Missing required deviceId.' });

      const isValid = await d1.verifySecretKey(db, deviceId, key);
      return jsonResponse(200, {
        valid: isValid,
        deviceId
      });
    }

    // Route: POST update secret key
    if (path === '/api/settings/secret-key' && method === 'POST') {
      const rawText = await request.text();
      let body = {};
      try { body = JSON.parse(rawText || '{}'); } catch (e) {}

      const deviceId = body.deviceId || queryDeviceId || headerDeviceId;
      const oldKey = body.oldKey || body.oldPin || '';
      const newKey = body.newKey || body.newPin || '';

      if (!deviceId) return jsonResponse(400, { error: 'Missing required deviceId.' });
      if (!newKey) return jsonResponse(400, { error: 'Missing required newKey.' });

      try {
        const result = await d1.updateSecretKey(db, deviceId, oldKey, newKey);
        if (!result.success) {
          return jsonResponse(403, { error: 'Incorrect existing secret key.' });
        }
        return jsonResponse(200, { success: true, message: 'Secret key updated successfully.' });
      } catch (e) {
        return jsonResponse(400, { error: e.message });
      }
    }

    // Route: POST queue message reply (STRICTLY PIN-PROTECTED)
    if (path === '/api/actions/reply' && method === 'POST') {
      const rawText = await request.text();
      let body = {};
      try { body = JSON.parse(rawText || '{}'); } catch (e) {}

      const deviceId = body.deviceId || queryDeviceId || headerDeviceId;
      const secretKey = body.secretKey || body.key || body.pin || '';
      const replyText = body.replyText || body.message || '';
      const senderName = body.senderName || '';
      const appName = body.appName || '';
      const notificationKey = body.notificationKey || '';

      if (!deviceId) return jsonResponse(400, { error: 'Missing required deviceId.' });
      if (!replyText) return jsonResponse(400, { error: 'Missing required replyText.' });

      // Enforce secret PIN verification before queueing reply!
      const isAuthorized = await d1.verifySecretKey(db, deviceId, secretKey);
      if (!isAuthorized) {
        return jsonResponse(403, {
          error: 'INCORRECT_SECRET_KEY',
          message: 'Action rejected: invalid or incorrect secret pin.'
        });
      }

      const action = await d1.queueDeviceAction(db, deviceId, {
        actionType: 'REPLY',
        targetKey: notificationKey,
        targetApp: appName,
        targetSender: senderName,
        payload: replyText
      });

      triggerRealtimeBroadcast(ctx, deviceId, {
        id: action.id,
        actionType: 'REPLY',
        targetKey: notificationKey,
        targetApp: appName,
        targetSender: senderName,
        payload: replyText
      });

      return jsonResponse(200, {
        success: true,
        actionId: action.id,
        status: action.status,
        message: `Reply scheduled for ${senderName || appName || 'recipient'}.`
      });
    }

    // Route: POST queue notification dismissal on physical phone
    if (path === '/api/actions/dismiss' && method === 'POST') {
      const rawText = await request.text();
      let body = {};
      try { body = JSON.parse(rawText || '{}'); } catch (e) {}

      const deviceId = body.deviceId || queryDeviceId || headerDeviceId;
      if (!deviceId) return jsonResponse(400, { error: 'Missing required deviceId.' });

      const action = await d1.queueDeviceAction(db, deviceId, {
        actionType: 'DISMISS',
        targetKey: body.notificationKey || '',
        targetApp: body.appName || '',
        payload: body.all ? 'ALL' : (body.appName || '')
      });

      triggerRealtimeBroadcast(ctx, deviceId, {
        id: action.id,
        actionType: 'DISMISS',
        targetKey: body.notificationKey || '',
        targetApp: body.appName || '',
        payload: body.all ? 'ALL' : (body.appName || '')
      });

      return jsonResponse(200, {
        success: true,
        actionId: action.id,
        message: 'Phone dismissal queued.'
      });
    }

    // Route: POST trigger / stop Find My Phone ringer
    if (path === '/api/actions/ring' && method === 'POST') {
      const rawText = await request.text();
      let body = {};
      try { body = JSON.parse(rawText || '{}'); } catch (e) {}

      const deviceId = body.deviceId || queryDeviceId || headerDeviceId;
      const shouldRing = body.ring !== false && body.stop !== true;
      if (!deviceId) return jsonResponse(400, { error: 'Missing required deviceId.' });

      const action = await d1.queueDeviceAction(db, deviceId, {
        actionType: shouldRing ? 'RING_PHONE' : 'STOP_RING',
        payload: shouldRing ? 'RING' : 'STOP'
      });

      triggerRealtimeBroadcast(ctx, deviceId, {
        id: action.id,
        actionType: shouldRing ? 'RING_PHONE' : 'STOP_RING',
        payload: shouldRing ? 'RING' : 'STOP'
      });

      return jsonResponse(200, {
        success: true,
        actionId: action.id,
        ringing: shouldRing,
        message: shouldRing ? 'Find My Phone triggered.' : 'Ringer stop queued.'
      });
    }

    // Route: GET pending device actions (called by Android app)
    if (path === '/api/actions/pending' && method === 'GET') {
      const deviceId = queryDeviceId || headerDeviceId;
      if (!deviceId) return jsonResponse(400, { error: 'Missing required deviceId.' });

      const pending = await d1.getPendingDeviceActions(db, deviceId);
      return jsonResponse(200, {
        success: true,
        actions: pending
      });
    }

    // Route: POST complete device action (called by Android app)
    if (path.startsWith('/api/actions/') && path.endsWith('/complete') && method === 'POST') {
      const match = path.match(/^\/api\/actions\/([^/]+)\/complete$/);
      const actionId = match ? match[1] : '';
      const rawText = await request.text();
      let body = {};
      try { body = JSON.parse(rawText || '{}'); } catch (e) {}

      const deviceId = body.deviceId || queryDeviceId || headerDeviceId;
      if (!deviceId || !actionId) return jsonResponse(400, { error: 'Missing deviceId or actionId.' });

      const result = await d1.completeDeviceAction(db, deviceId, actionId, {
        success: body.success !== false,
        error: body.error || ''
      });

      return jsonResponse(200, {
        success: true,
        result
      });
    }

    // Route: GET missed calls
    if (path === '/api/notifications/missed-calls' && method === 'GET') {
      const deviceId = queryDeviceId || headerDeviceId;
      if (!deviceId) return jsonResponse(400, { error: 'Missing required deviceId.' });

      const missed = await d1.getMissedCalls(db, deviceId);
      return jsonResponse(200, {
        success: true,
        count: missed.length,
        missedCalls: missed
      });
    }

    // Route: GET emergency and VIP notifications
    if (path === '/api/notifications/emergency' && method === 'GET') {
      const deviceId = queryDeviceId || headerDeviceId;
      if (!deviceId) return jsonResponse(400, { error: 'Missing required deviceId.' });

      const result = await d1.getEmergencyAndVipNotifications(db, deviceId);
      return jsonResponse(200, {
        success: true,
        ...result
      });
    }

    // Route: GET daily briefing
    if (path === '/api/briefing' && method === 'GET') {
      const deviceId = queryDeviceId || headerDeviceId;
      if (!deviceId) return jsonResponse(400, { error: 'Missing required deviceId.' });

      const briefing = await d1.getDailyBriefing(db, deviceId);
      return jsonResponse(200, {
        success: true,
        briefing
      });
    }

    // Route: GET settings (DND mode, Priority Apps, VIP Contacts, hasSecretKey)
    if (isSettingsPath && method === 'GET') {
      const deviceId = queryDeviceId || headerDeviceId;
      if (!deviceId) {
        return jsonResponse(400, { error: 'Missing required query parameter: deviceId.' });
      }

      const settings = await d1.getDeviceSettings(db, deviceId);
      return jsonResponse(200, {
        success: true,
        deviceId,
        settings: {
          dndEnabled: settings.dndEnabled,
          priorityApps: settings.priorityApps,
          vipContacts: settings.vipContacts,
          emergencyKeywords: settings.emergencyKeywords,
          hasSecretKey: Boolean(settings.secretKey)
        }
      });
    }

    // Route: POST settings (update DND mode, Priority Apps, VIP Contacts)
    if (isSettingsPath && method === 'POST') {
      const rawText = await request.text();
      let body = {};
      try {
        body = JSON.parse(rawText || '{}');
      } catch (e) {
        return jsonResponse(400, { error: 'Invalid JSON payload in settings request.' });
      }

      const deviceId = body.deviceId || queryDeviceId || headerDeviceId;
      if (!deviceId) {
        return jsonResponse(400, { error: 'Missing required deviceId.' });
      }

      const updated = await d1.updateDeviceSettings(db, deviceId, body);
      return jsonResponse(200, {
        success: true,
        deviceId,
        settings: {
          dndEnabled: updated.dndEnabled,
          priorityApps: updated.priorityApps,
          vipContacts: updated.vipContacts,
          emergencyKeywords: updated.emergencyKeywords,
          hasSecretKey: Boolean(updated.secretKey)
        }
      });
    }

    // Route Not Found
    return jsonResponse(404, {
      error: `Not Found: ${method} ${path}`
    });


  } catch (err) {
    // Avoid logging sensitive notification content or tokens
    console.error('API Error processing request:', err.message);
    return jsonResponse(500, {
      error: 'Internal server error processing request.'
    });
  }
}

export default {
  fetch: handleRequest,
  async scheduled(event, env, ctx) {
    if (env.DB) {
      const retentionDays = Number(env.RETENTION_DAYS || 7);
      await d1.pruneOldNotifications(env.DB, retentionDays);
    }
  }
};
