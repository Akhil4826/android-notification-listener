/**
 * Notification data access service for Alexa Skill.
 * Fetches notifications via direct DynamoDB table query (low latency)
 * or via HTTPS backend API.
 */

const https = require('https');
const http = require('http');
const { isContactMatch } = require('./contactMatcher');

// High-performance HTTP Keep-Alive connection pooling agents (reuses TLS sockets across turns)
const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 32,
  maxFreeSockets: 10,
  timeout: 8000
});

const httpAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 32,
  maxFreeSockets: 10,
  timeout: 8000
});

// Universal HTTP helper compatible with all Node versions (including Node 14/16/18/20/22)
async function request(urlStr, { method = 'GET', headers = {}, body = null } = {}) {
  if (typeof fetch === 'function') {
    return fetch(urlStr, {
      method,
      headers,
      body: body ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
      keepalive: true
    });
  }

  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(urlStr);
    const isHttps = parsedUrl.protocol === 'https:';
    const transport = isHttps ? https : http;
    const agent = isHttps ? httpsAgent : httpAgent;

    const req = transport.request({
      protocol: parsedUrl.protocol,
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: `${parsedUrl.pathname}${parsedUrl.search}`,
      method: method.toUpperCase(),
      headers,
      agent
    }, (res) => {
      let responseBody = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { responseBody += chunk; });
      res.on('end', () => {
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          json: async () => (responseBody ? JSON.parse(responseBody) : {}),
          text: async () => responseBody
        });
      });
    });

    req.on('error', reject);
    req.setTimeout(8000, () => {
      req.destroy();
      reject(new Error('Backend connection timed out'));
    });

    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

// In-memory mock list for testing
let mockNotifications = null;

function setMockNotifications(list) {
  mockNotifications = list;
}

/**
 * Content-based deduplication: ensures notifications with identical app, sender,
 * and text body are never spoken or listed multiple times to the user.
 */
function deduplicateNotifications(notifications = []) {
  if (!Array.isArray(notifications)) return [];
  const seen = new Set();
  return notifications.filter(n => {
    const app = (n.appName || n.packageName || '').toLowerCase().trim();
    const sender = (n.title || '').trim();
    const text = (n.text || n.bigText || '').trim();
    const key = `${app}:::${sender}:::${text}`;
    if (text.length > 0 && seen.has(key)) {
      return false;
    }
    if (text.length > 0) {
      seen.add(key);
    }
    return true;
  });
}

/**
 * Fetch active notifications with optional app and sender filtering.
 */
async function fetchActiveNotifications({ deviceId, appFilter = '', senderFilter = '', limit = 10 } = {}) {
  // If test mock is set
  if (mockNotifications !== null) {
    let items = mockNotifications.filter(n => n.isActive === true);
    if (deviceId) {
      items = items.filter(n => n.deviceId === deviceId);
    }
    if (appFilter) {
      const f = appFilter.toLowerCase().trim();
      items = items.filter(n =>
        (n.appName && n.appName.toLowerCase().includes(f)) ||
        (n.packageName && n.packageName.toLowerCase().includes(f))
      );
    }
    if (senderFilter) {
      items = items.filter(n =>
        isContactMatch(n.title || '', n.subText || '', (n.text || '') + ' ' + (n.bigText || ''), senderFilter)
      );
    }
    items.sort((a, b) => (b.postedAt || 0) - (a.postedAt || 0));
    return items.slice(0, limit);
  }

  const effectiveDeviceId = deviceId || process.env.DEVICE_ID;
  if (!effectiveDeviceId) {
    throw new Error('DEVICE_ID_NOT_CONFIGURED');
  }

  // Strategy A: If TABLE_NAME is set, read directly from DynamoDB for fastest response
  if (process.env.TABLE_NAME) {
    try {
      const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
      const { DynamoDBDocumentClient, QueryCommand } = require('@aws-sdk/lib-dynamodb');
      const client = new DynamoDBClient({ region: process.env.AWS_REGION || 'ap-south-1' });
      const docClient = DynamoDBDocumentClient.from(client);

      const response = await docClient.send(new QueryCommand({
        TableName: process.env.TABLE_NAME,
        KeyConditionExpression: 'deviceId = :deviceId',
        FilterExpression: 'isActive = :isActive',
        ExpressionAttributeValues: {
          ':deviceId': effectiveDeviceId,
          ':isActive': true
        }
      }));

      let items = response.Items || [];
      if (appFilter) {
        const f = appFilter.toLowerCase().trim();
        items = items.filter(n =>
          (n.appName && n.appName.toLowerCase().includes(f)) ||
          (n.packageName && n.packageName.toLowerCase().includes(f))
        );
      }
      if (senderFilter) {
        items = items.filter(n =>
          isContactMatch(n.title || '', n.subText || '', (n.text || '') + ' ' + (n.bigText || ''), senderFilter)
        );
      }
      items.sort((a, b) => (b.postedAt || 0) - (a.postedAt || 0));
      return deduplicateNotifications(items).slice(0, limit);
    } catch (err) {
      console.warn('Direct DynamoDB query failed, falling back to HTTP if configured:', err.message);
    }
  }

  // Strategy B: Call HTTP API
  const backendUrl = process.env.BACKEND_URL;
  if (!backendUrl) {
    throw new Error('BACKEND_NOT_CONFIGURED');
  }

  const token = process.env.API_TOKEN || process.env.DEVICE_TOKEN || '';
  const url = new URL(`${backendUrl.replace(/\/$/, '')}/api/notifications/active`);
  url.searchParams.set('deviceId', effectiveDeviceId);
  if (appFilter) {
    url.searchParams.set('app', appFilter);
  }
  if (senderFilter) {
    url.searchParams.set('sender', senderFilter);
  }
  url.searchParams.set('limit', String(limit));

  const response = await request(url.toString(), {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'X-Device-Id': effectiveDeviceId,
      'Accept': 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`HTTP_${response.status}`);
  }

  const data = await response.json();
  const rawList = data.notifications || [];
  return deduplicateNotifications(rawList);
}

/**
 * Fetch active notifications filtered by sender name (e.g. Mom, Rahul).
 */
async function fetchNotificationsBySender({ deviceId, senderName, appFilter = '', limit = 10 } = {}) {
  return fetchActiveNotifications({ deviceId, appFilter, senderFilter: senderName, limit });
}

/**
 * Fetch the single latest active notification.
 */
async function fetchLatestNotification({ deviceId, appFilter = '' } = {}) {
  const items = await fetchActiveNotifications({ deviceId, appFilter, limit: 1 });
  return items.length > 0 ? items[0] : null;
}

/**
 * Clear notifications for device on backend, optionally filtered by app.
 */
async function clearNotifications({ deviceId, appFilter = '' } = {}) {
  if (mockNotifications !== null) {
    if (appFilter) {
      const f = appFilter.toLowerCase().trim();
      const initialCount = mockNotifications.length;
      mockNotifications = mockNotifications.filter(n =>
        !(n.appName && n.appName.toLowerCase().includes(f)) &&
        !(n.packageName && n.packageName.toLowerCase().includes(f))
      );
      return initialCount - mockNotifications.length;
    }
    const count = mockNotifications.length;
    mockNotifications = [];
    return count;
  }

  const effectiveDeviceId = deviceId || process.env.DEVICE_ID;
  if (!effectiveDeviceId) {
    throw new Error('DEVICE_ID_NOT_CONFIGURED');
  }

  const backendUrl = process.env.BACKEND_URL;
  if (!backendUrl) {
    throw new Error('BACKEND_NOT_CONFIGURED');
  }

  const token = process.env.API_TOKEN || process.env.DEVICE_TOKEN || '';
  const url = new URL(`${backendUrl.replace(/\/$/, '')}/api/notifications`);
  url.searchParams.set('deviceId', effectiveDeviceId);
  if (appFilter) {
    url.searchParams.set('app', appFilter);
  }

  const response = await request(url.toString(), {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${token}`,
      'X-Device-Id': effectiveDeviceId,
      'Accept': 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`HTTP_${response.status}`);
  }

  const data = await response.json();
  return data.deletedCount || 0;
}

/**
 * Fetch total and per-app notification counts.
 */
async function fetchNotificationCount({ deviceId } = {}) {
  if (mockNotifications !== null) {
    const active = mockNotifications.filter(n => n.isActive === true);
    const byApp = {};
    for (const n of active) {
      const app = n.appName || 'Unknown';
      byApp[app] = (byApp[app] || 0) + 1;
    }
    return { total: active.length, byApp };
  }

  const effectiveDeviceId = deviceId || process.env.DEVICE_ID;
  if (!effectiveDeviceId) {
    throw new Error('DEVICE_ID_NOT_CONFIGURED');
  }

  const backendUrl = process.env.BACKEND_URL;
  if (!backendUrl) {
    throw new Error('BACKEND_NOT_CONFIGURED');
  }

  const token = process.env.API_TOKEN || process.env.DEVICE_TOKEN || '';
  const url = new URL(`${backendUrl.replace(/\/$/, '')}/api/notifications/count`);
  url.searchParams.set('deviceId', effectiveDeviceId);

  const response = await request(url.toString(), {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'X-Device-Id': effectiveDeviceId,
      'Accept': 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`HTTP_${response.status}`);
  }

  return await response.json();
}

/**
 * Fetch device settings (DND status and priority apps).
 */
async function fetchSettings({ deviceId } = {}) {
  if (mockNotifications !== null && global.__mockSettings) {
    return global.__mockSettings;
  }

  const effectiveDeviceId = deviceId || process.env.DEVICE_ID;
  if (!effectiveDeviceId) {
    throw new Error('DEVICE_ID_NOT_CONFIGURED');
  }

  const backendUrl = process.env.BACKEND_URL;
  if (!backendUrl) {
    throw new Error('BACKEND_NOT_CONFIGURED');
  }

  const token = process.env.API_TOKEN || process.env.DEVICE_TOKEN || '';
  const url = new URL(`${backendUrl.replace(/\/$/, '')}/api/settings`);
  url.searchParams.set('deviceId', effectiveDeviceId);

  const response = await request(url.toString(), {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'X-Device-Id': effectiveDeviceId,
      'Accept': 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`HTTP_${response.status}`);
  }

  const data = await response.json();
  return data.settings || { dndEnabled: false, priorityApps: ['WhatsApp'] };
}

/**
 * Update device settings (DND status and priority apps).
 */
async function updateSettings({ deviceId, dndEnabled, priorityApps } = {}) {
  if (mockNotifications !== null) {
    if (!global.__mockSettings) {
      global.__mockSettings = { dndEnabled: false, priorityApps: ['WhatsApp'] };
    }
    if (typeof dndEnabled === 'boolean') global.__mockSettings.dndEnabled = dndEnabled;
    if (Array.isArray(priorityApps)) global.__mockSettings.priorityApps = priorityApps;
    return global.__mockSettings;
  }

  const effectiveDeviceId = deviceId || process.env.DEVICE_ID;
  if (!effectiveDeviceId) {
    throw new Error('DEVICE_ID_NOT_CONFIGURED');
  }

  const backendUrl = process.env.BACKEND_URL;
  if (!backendUrl) {
    throw new Error('BACKEND_NOT_CONFIGURED');
  }

  const token = process.env.API_TOKEN || process.env.DEVICE_TOKEN || '';
  const url = new URL(`${backendUrl.replace(/\/$/, '')}/api/settings`);

  const payload = { deviceId: effectiveDeviceId };
  if (typeof dndEnabled === 'boolean') payload.dndEnabled = dndEnabled;
  if (Array.isArray(priorityApps)) payload.priorityApps = priorityApps;

  const response = await request(url.toString(), {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'X-Device-Id': effectiveDeviceId,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`HTTP_${response.status}`);
  }

  const data = await response.json();
  return data.settings || { dndEnabled: false, priorityApps: ['WhatsApp'] };
}

/**
 * Fetch phone status and sync heartbeat from backend.
 */
async function fetchPhoneStatus({ deviceId } = {}) {
  if (mockNotifications !== null) {
    const active = mockNotifications.filter(n => n.isActive === true);
    return {
      isHealthy: true,
      lastSyncTime: Date.now() - 60000, // 1 minute ago
      activeCount: active.length,
      totalStored: mockNotifications.length
    };
  }

  const effectiveDeviceId = deviceId || process.env.DEVICE_ID;
  if (!effectiveDeviceId) {
    throw new Error('DEVICE_ID_NOT_CONFIGURED');
  }

  const backendUrl = process.env.BACKEND_URL;
  if (!backendUrl) {
    throw new Error('BACKEND_NOT_CONFIGURED');
  }

  const token = process.env.API_TOKEN || process.env.DEVICE_TOKEN || '';
  const url = new URL(`${backendUrl.replace(/\/$/, '')}/api/status`);
  url.searchParams.set('deviceId', effectiveDeviceId);

  const response = await request(url.toString(), {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'X-Device-Id': effectiveDeviceId,
      'Accept': 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`HTTP_${response.status}`);
  }

  const data = await response.json();
  return data.status || { isHealthy: false, lastSyncTime: 0, activeCount: 0, totalStored: 0 };
}

/**
 * Verify secret key for sending message.
 */
async function verifySecretKey(candidateKey = '', { deviceId } = {}) {
  const cleanKey = (candidateKey || '').toString().replace(/[\s-]/g, '').trim();
  if (mockNotifications !== null) {
    return cleanKey === '4826';
  }

  const effectiveDeviceId = deviceId || process.env.DEVICE_ID;
  if (!effectiveDeviceId) throw new Error('DEVICE_ID_NOT_CONFIGURED');
  const backendUrl = process.env.BACKEND_URL;
  if (!backendUrl) throw new Error('BACKEND_NOT_CONFIGURED');

  const token = process.env.API_TOKEN || process.env.DEVICE_TOKEN || '';
  const url = `${backendUrl.replace(/\/$/, '')}/api/settings/secret-key/verify`;

  const response = await request(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'X-Device-Id': effectiveDeviceId,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: { deviceId: effectiveDeviceId, key: cleanKey }
  });

  if (!response.ok) return false;
  const data = await response.json();
  return Boolean(data.valid);
}

/**
 * Change secret key.
 */
async function changeSecretKey(oldKey = '', newKey = '', { deviceId } = {}) {
  const cleanOld = (oldKey || '').toString().replace(/[\s-]/g, '').trim();
  const cleanNew = (newKey || '').toString().replace(/[\s-]/g, '').trim();

  if (mockNotifications !== null) {
    if (cleanOld !== '4826') {
      return { success: false, error: 'Incorrect existing secret key.' };
    }
    return { success: true };
  }

  const effectiveDeviceId = deviceId || process.env.DEVICE_ID;
  if (!effectiveDeviceId) throw new Error('DEVICE_ID_NOT_CONFIGURED');
  const backendUrl = process.env.BACKEND_URL;
  if (!backendUrl) throw new Error('BACKEND_NOT_CONFIGURED');

  const token = process.env.API_TOKEN || process.env.DEVICE_TOKEN || '';
  const url = `${backendUrl.replace(/\/$/, '')}/api/settings/secret-key`;

  const response = await request(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'X-Device-Id': effectiveDeviceId,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: { deviceId: effectiveDeviceId, oldKey: cleanOld, newKey: cleanNew }
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    return { success: false, error: errData.error || 'Failed to update secret key.' };
  }

  return { success: true };
}

/**
 * Send voice / text reply to notification (PROTECTED BY SECRET KEY).
 */
async function sendReplyMessage({
  secretKey = '',
  senderName = '',
  appName = '',
  notificationKey = '',
  replyText = '',
  deviceId
} = {}) {
  const cleanKey = (secretKey || '').toString().replace(/[\s-]/g, '').trim();

  if (mockNotifications !== null) {
    if (cleanKey !== '4826') {
      throw new Error('INCORRECT_SECRET_KEY');
    }
    return {
      success: true,
      actionId: `act_mock_${Date.now()}`,
      message: `Reply scheduled for ${senderName || appName}.`
    };
  }

  const effectiveDeviceId = deviceId || process.env.DEVICE_ID;
  if (!effectiveDeviceId) throw new Error('DEVICE_ID_NOT_CONFIGURED');
  const backendUrl = process.env.BACKEND_URL;
  if (!backendUrl) throw new Error('BACKEND_NOT_CONFIGURED');

  const token = process.env.API_TOKEN || process.env.DEVICE_TOKEN || '';
  const url = `${backendUrl.replace(/\/$/, '')}/api/actions/reply`;

  const response = await request(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'X-Device-Id': effectiveDeviceId,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: {
      deviceId: effectiveDeviceId,
      secretKey: cleanKey,
      senderName,
      appName,
      notificationKey,
      replyText
    }
  });

  if (response.status === 403) {
    throw new Error('INCORRECT_SECRET_KEY');
  }

  if (!response.ok) {
    throw new Error(`HTTP_${response.status}`);
  }

  return response.json();
}

/**
 * Dismiss notifications directly from physical phone.
 */
async function dismissPhoneNotifications({ appName = '', notificationKey = '', all = false, deviceId } = {}) {
  if (mockNotifications !== null) {
    return { success: true, message: 'Phone dismissal queued.' };
  }

  const effectiveDeviceId = deviceId || process.env.DEVICE_ID;
  if (!effectiveDeviceId) throw new Error('DEVICE_ID_NOT_CONFIGURED');
  const backendUrl = process.env.BACKEND_URL;
  if (!backendUrl) throw new Error('BACKEND_NOT_CONFIGURED');

  const token = process.env.API_TOKEN || process.env.DEVICE_TOKEN || '';
  const url = `${backendUrl.replace(/\/$/, '')}/api/actions/dismiss`;

  const response = await request(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'X-Device-Id': effectiveDeviceId,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: {
      deviceId: effectiveDeviceId,
      appName,
      notificationKey,
      all
    }
  });

  if (!response.ok) throw new Error(`HTTP_${response.status}`);
  return response.json();
}

/**
 * Trigger Find My Phone ringer on device.
 */
async function triggerFindMyPhone({ ring = true, deviceId } = {}) {
  if (mockNotifications !== null) {
    return { success: true, ringing: ring };
  }

  const effectiveDeviceId = deviceId || process.env.DEVICE_ID;
  if (!effectiveDeviceId) throw new Error('DEVICE_ID_NOT_CONFIGURED');
  const backendUrl = process.env.BACKEND_URL;
  if (!backendUrl) throw new Error('BACKEND_NOT_CONFIGURED');

  const token = process.env.API_TOKEN || process.env.DEVICE_TOKEN || '';
  const url = `${backendUrl.replace(/\/$/, '')}/api/actions/ring`;

  const response = await request(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'X-Device-Id': effectiveDeviceId,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: {
      deviceId: effectiveDeviceId,
      ring
    }
  });

  if (!response.ok) throw new Error(`HTTP_${response.status}`);
  return response.json();
}

/**
 * Fetch missed calls from phone.
 */
async function fetchMissedCalls({ deviceId } = {}) {
  if (mockNotifications !== null) {
    return mockNotifications.filter(n =>
      (n.category === 'missed_call' || n.category === 'call' || (n.appName && n.appName.toLowerCase().includes('phone'))) &&
      n.isActive === true
    );
  }

  const effectiveDeviceId = deviceId || process.env.DEVICE_ID;
  if (!effectiveDeviceId) throw new Error('DEVICE_ID_NOT_CONFIGURED');
  const backendUrl = process.env.BACKEND_URL;
  if (!backendUrl) throw new Error('BACKEND_NOT_CONFIGURED');

  const token = process.env.API_TOKEN || process.env.DEVICE_TOKEN || '';
  const url = new URL(`${backendUrl.replace(/\/$/, '')}/api/notifications/missed-calls`);
  url.searchParams.set('deviceId', effectiveDeviceId);

  const response = await request(url.toString(), {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'X-Device-Id': effectiveDeviceId,
      'Accept': 'application/json'
    }
  });

  if (!response.ok) throw new Error(`HTTP_${response.status}`);
  const data = await response.json();
  return data.missedCalls || [];
}

/**
 * Fetch daily briefing report.
 */
async function fetchDailyBriefing({ deviceId } = {}) {
  if (mockNotifications !== null) {
    const active = mockNotifications.filter(n => n.isActive === true);
    const missed = active.filter(n => n.category === 'missed_call' || n.category === 'call');
    return {
      batteryLevel: 85,
      isCharging: true,
      chargingType: 'AC',
      isHealthy: true,
      totalActiveNotifications: active.length,
      missedCallsCount: missed.length,
      missedCalls: missed,
      vipMessagesCount: 0,
      vipMessages: [],
      emergencyCount: 0,
      emergencyMessages: [],
      dndEnabled: false
    };
  }

  const effectiveDeviceId = deviceId || process.env.DEVICE_ID;
  if (!effectiveDeviceId) throw new Error('DEVICE_ID_NOT_CONFIGURED');
  const backendUrl = process.env.BACKEND_URL;
  if (!backendUrl) throw new Error('BACKEND_NOT_CONFIGURED');

  const token = process.env.API_TOKEN || process.env.DEVICE_TOKEN || '';
  const url = new URL(`${backendUrl.replace(/\/$/, '')}/api/briefing`);
  url.searchParams.set('deviceId', effectiveDeviceId);

  const response = await request(url.toString(), {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'X-Device-Id': effectiveDeviceId,
      'Accept': 'application/json'
    }
  });

  if (!response.ok) throw new Error(`HTTP_${response.status}`);
  const data = await response.json();
  return data.briefing || {};
}

module.exports = {
  fetchActiveNotifications,
  fetchNotificationsBySender,
  fetchLatestNotification,
  clearNotifications,
  fetchNotificationCount,
  fetchSettings,
  updateSettings,
  fetchPhoneStatus,
  setMockNotifications,
  verifySecretKey,
  changeSecretKey,
  sendReplyMessage,
  dismissPhoneNotifications,
  triggerFindMyPhone,
  fetchMissedCalls,
  fetchDailyBriefing
};


