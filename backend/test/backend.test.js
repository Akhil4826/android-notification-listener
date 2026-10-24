const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const { handler } = require('../src/api');
const db = require('../src/db');

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.USE_MOCK_DB = 'true';
process.env.API_TOKEN = 'secret-test-token-12345';

const AUTH_HEADER = {
  'Authorization': 'Bearer secret-test-token-12345',
  'Content-Type': 'application/json'
};

const TEST_DEVICE_ID = 'device-test-uuid-999';

function createEvent({
  method = 'GET',
  path = '/api/health',
  headers = AUTH_HEADER,
  body = null,
  queryStringParameters = null
}) {
  return {
    httpMethod: method,
    path,
    headers: { ...headers },
    body: body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null,
    queryStringParameters
  };
}

describe('Backend API Test Suite', () => {
  beforeEach(() => {
    db.clearMockStore();
  });

  test('Health check endpoint returns 200 without authentication', async () => {
    const event = createEvent({
      method: 'GET',
      path: '/api/health',
      headers: {} // No auth
    });

    const response = await handler(event);
    assert.strictEqual(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.strictEqual(body.status, 'ok');
    assert.strictEqual(body.service, 'phone-reader-backend');
    assert.ok(body.timestamp > 0);
  });

  test('Fails on invalid or missing authorization token', async () => {
    const eventMissingAuth = createEvent({
      method: 'GET',
      path: '/api/notifications/active',
      headers: {},
      queryStringParameters: { deviceId: TEST_DEVICE_ID }
    });
    const resMissing = await handler(eventMissingAuth);
    assert.strictEqual(resMissing.statusCode, 401);

    const eventInvalidAuth = createEvent({
      method: 'GET',
      path: '/api/notifications/active',
      headers: { 'Authorization': 'Bearer wrong-token' },
      queryStringParameters: { deviceId: TEST_DEVICE_ID }
    });
    const resInvalid = await handler(eventInvalidAuth);
    assert.strictEqual(resInvalid.statusCode, 403);
  });

  test('Fails on invalid or malformed request payload', async () => {
    const event = {
      httpMethod: 'POST',
      path: '/api/notifications',
      headers: AUTH_HEADER,
      body: 'this is not valid json'
    };

    const response = await handler(event);
    assert.strictEqual(response.statusCode, 400);
    const body = JSON.parse(response.body);
    assert.ok(body.error.includes('Malformed JSON'));
  });

  test('Fails when payload exceeds size limit', async () => {
    const hugeString = 'A'.repeat(300 * 1024); // 300 KB > 256 KB
    const event = {
      httpMethod: 'POST',
      path: '/api/notifications',
      headers: AUTH_HEADER,
      body: JSON.stringify({ deviceId: TEST_DEVICE_ID, text: hugeString })
    };

    const response = await handler(event);
    assert.strictEqual(response.statusCode, 413);
  });

  test('Returns empty list when there are no active notifications', async () => {
    const event = createEvent({
      method: 'GET',
      path: '/api/notifications/active',
      queryStringParameters: { deviceId: TEST_DEVICE_ID }
    });

    const response = await handler(event);
    assert.strictEqual(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.count, 0);
    assert.deepStrictEqual(body.notifications, []);
  });

  test('Uploads and retrieves a single active notification', async () => {
    const notif = {
      id: 'hash-whatsapp-1',
      notificationKey: '0|com.whatsapp|100|tag|1',
      deviceId: TEST_DEVICE_ID,
      packageName: 'com.whatsapp',
      appName: 'WhatsApp',
      title: 'Alice',
      text: 'Are we still meeting at six?',
      bigText: 'Are we still meeting at six?',
      category: 'msg',
      postedAt: 1700000001000,
      isActive: true,
      contentAvailable: true
    };

    const uploadEvent = createEvent({
      method: 'POST',
      path: '/api/notifications',
      body: notif
    });

    const uploadRes = await handler(uploadEvent);
    assert.strictEqual(uploadRes.statusCode, 200);

    const getEvent = createEvent({
      method: 'GET',
      path: '/api/notifications/active',
      queryStringParameters: { deviceId: TEST_DEVICE_ID }
    });

    const getRes = await handler(getEvent);
    assert.strictEqual(getRes.statusCode, 200);
    const body = JSON.parse(getRes.body);
    assert.strictEqual(body.count, 1);
    assert.strictEqual(body.notifications[0].appName, 'WhatsApp');
    assert.strictEqual(body.notifications[0].text, 'Are we still meeting at six?');
  });

  test('Uploads multiple notifications and filters by WhatsApp and Instagram', async () => {
    const notifWhatsapp = {
      id: 'h-wa',
      notificationKey: '0|com.whatsapp|1|tag',
      deviceId: TEST_DEVICE_ID,
      packageName: 'com.whatsapp',
      appName: 'WhatsApp',
      title: 'Alice',
      text: 'Hello from WhatsApp',
      postedAt: 1700000002000,
      isActive: true
    };

    const notifInstagram = {
      id: 'h-ig',
      notificationKey: '0|com.instagram.android|2|tag',
      deviceId: TEST_DEVICE_ID,
      packageName: 'com.instagram.android',
      appName: 'Instagram',
      title: 'Instagram',
      text: 'Someone shared a reel with you',
      postedAt: 1700000003000,
      isActive: true
    };

    const notifGmail = {
      id: 'h-gm',
      notificationKey: '0|com.google.android.gm|3|tag',
      deviceId: TEST_DEVICE_ID,
      packageName: 'com.google.android.gm',
      appName: 'Gmail',
      title: 'Team Update',
      text: 'Sprint review tomorrow',
      postedAt: 1700000001000,
      isActive: true
    };

    // Batch upload
    const batchUpload = createEvent({
      method: 'POST',
      path: '/api/notifications',
      body: {
        deviceId: TEST_DEVICE_ID,
        notifications: [notifWhatsapp, notifInstagram, notifGmail]
      }
    });

    const batchRes = await handler(batchUpload);
    assert.strictEqual(batchRes.statusCode, 200);

    // Retrieve all active
    const allRes = await handler(createEvent({
      method: 'GET',
      path: '/api/notifications/active',
      queryStringParameters: { deviceId: TEST_DEVICE_ID }
    }));
    const allBody = JSON.parse(allRes.body);
    assert.strictEqual(allBody.count, 3);
    // Should be sorted newest first (Instagram 1700000003000 is top)
    assert.strictEqual(allBody.notifications[0].appName, 'Instagram');

    // Filter by WhatsApp
    const waRes = await handler(createEvent({
      method: 'GET',
      path: '/api/notifications/active',
      queryStringParameters: { deviceId: TEST_DEVICE_ID, app: 'whatsapp' }
    }));
    const waBody = JSON.parse(waRes.body);
    assert.strictEqual(waBody.count, 1);
    assert.strictEqual(waBody.notifications[0].appName, 'WhatsApp');

    // Filter by Instagram
    const igRes = await handler(createEvent({
      method: 'GET',
      path: '/api/notifications/active',
      queryStringParameters: { deviceId: TEST_DEVICE_ID, app: 'instagram' }
    }));
    const igBody = JSON.parse(igRes.body);
    assert.strictEqual(igBody.count, 1);
    assert.strictEqual(igBody.notifications[0].appName, 'Instagram');
  });

  test('Retrieves the latest notification correctly', async () => {
    const notifOlder = {
      id: 'h-1',
      notificationKey: 'k-1',
      deviceId: TEST_DEVICE_ID,
      packageName: 'com.whatsapp',
      appName: 'WhatsApp',
      title: 'Older message',
      postedAt: 1000,
      isActive: true
    };
    const notifNewer = {
      id: 'h-2',
      notificationKey: 'k-2',
      deviceId: TEST_DEVICE_ID,
      packageName: 'com.instagram.android',
      appName: 'Instagram',
      title: 'Newest message',
      postedAt: 5000,
      isActive: true
    };

    await handler(createEvent({
      method: 'POST',
      path: '/api/notifications',
      body: { deviceId: TEST_DEVICE_ID, notifications: [notifOlder, notifNewer] }
    }));

    const latestRes = await handler(createEvent({
      method: 'GET',
      path: '/api/notifications/latest',
      queryStringParameters: { deviceId: TEST_DEVICE_ID }
    }));

    assert.strictEqual(latestRes.statusCode, 200);
    const body = JSON.parse(latestRes.body);
    assert.strictEqual(body.hasNotification, true);
    assert.strictEqual(body.notification.title, 'Newest message');
  });

  test('Handles notification update and deduplication', async () => {
    const original = {
      id: 'h-update-1',
      notificationKey: 'unique-key-1',
      deviceId: TEST_DEVICE_ID,
      packageName: 'com.whatsapp',
      appName: 'WhatsApp',
      title: 'Initial text',
      postedAt: 1000,
      isActive: true
    };

    await handler(createEvent({ method: 'POST', path: '/api/notifications', body: original }));

    // Now update notification text
    const updated = {
      ...original,
      id: 'h-update-2',
      title: 'Updated text received',
      updatedAt: 2000
    };

    await handler(createEvent({ method: 'POST', path: '/api/notifications', body: updated }));

    const res = await handler(createEvent({
      method: 'GET',
      path: '/api/notifications/active',
      queryStringParameters: { deviceId: TEST_DEVICE_ID }
    }));

    const body = JSON.parse(res.body);
    assert.strictEqual(body.count, 1);
    assert.strictEqual(body.notifications[0].title, 'Updated text received');
  });

  test('Handles notification dismissal / removal', async () => {
    const notif = {
      id: 'h-dismiss',
      notificationKey: 'dismiss-key-1',
      deviceId: TEST_DEVICE_ID,
      packageName: 'com.whatsapp',
      appName: 'WhatsApp',
      title: 'Message to dismiss',
      postedAt: 1000,
      isActive: true
    };

    // Post notification
    await handler(createEvent({ method: 'POST', path: '/api/notifications', body: notif }));

    // Verify it is active
    let res = await handler(createEvent({
      method: 'GET',
      path: '/api/notifications/active',
      queryStringParameters: { deviceId: TEST_DEVICE_ID }
    }));
    assert.strictEqual(JSON.parse(res.body).count, 1);

    // Dismiss notification (isActive: false, eventType: "REMOVED")
    const dismissal = {
      ...notif,
      isActive: false,
      eventType: 'REMOVED',
      updatedAt: 1500
    };
    await handler(createEvent({ method: 'POST', path: '/api/notifications', body: dismissal }));

    // Verify it is no longer active
    res = await handler(createEvent({
      method: 'GET',
      path: '/api/notifications/active',
      queryStringParameters: { deviceId: TEST_DEVICE_ID }
    }));
    assert.strictEqual(JSON.parse(res.body).count, 0);
  });

  test('Full active synchronization marks disappeared notifications inactive', async () => {
    // Device had notification A and B
    const notifA = { id: 'a', notificationKey: 'key-A', deviceId: TEST_DEVICE_ID, packageName: 'pkg', appName: 'A', isActive: true, postedAt: 100 };
    const notifB = { id: 'b', notificationKey: 'key-B', deviceId: TEST_DEVICE_ID, packageName: 'pkg', appName: 'B', isActive: true, postedAt: 200 };

    await handler(createEvent({
      method: 'POST',
      path: '/api/notifications',
      body: { deviceId: TEST_DEVICE_ID, notifications: [notifA, notifB] }
    }));

    // Now phone syncs active list with ONLY notification B and new notification C (A was cleared on phone while offline)
    const notifC = { id: 'c', notificationKey: 'key-C', deviceId: TEST_DEVICE_ID, packageName: 'pkg', appName: 'C', isActive: true, postedAt: 300 };

    await handler(createEvent({
      method: 'POST',
      path: '/api/notifications',
      body: {
        deviceId: TEST_DEVICE_ID,
        isFullActiveSync: true,
        notifications: [notifB, notifC]
      }
    }));

    const res = await handler(createEvent({
      method: 'GET',
      path: '/api/notifications/active',
      queryStringParameters: { deviceId: TEST_DEVICE_ID }
    }));

    const body = JSON.parse(res.body);
    assert.strictEqual(body.count, 2);
    const activeKeys = body.notifications.map(n => n.notificationKey);
    assert.ok(activeKeys.includes('key-B'));
    assert.ok(activeKeys.includes('key-C'));
    assert.ok(!activeKeys.includes('key-A')); // A was marked inactive
  });

  test('Acknowledges notifications as read by Alexa', async () => {
    const notif = {
      id: 'h-ack',
      notificationKey: 'key-ack-1',
      deviceId: TEST_DEVICE_ID,
      packageName: 'com.whatsapp',
      appName: 'WhatsApp',
      title: 'Message',
      postedAt: 1000,
      isActive: true,
      isReadByAlexa: false
    };

    await handler(createEvent({ method: 'POST', path: '/api/notifications', body: notif }));

    const ackEvent = createEvent({
      method: 'POST',
      path: '/api/notifications/ack',
      body: {
        deviceId: TEST_DEVICE_ID,
        notificationKeys: ['key-ack-1']
      }
    });

    const ackRes = await handler(ackEvent);
    assert.strictEqual(ackRes.statusCode, 200);
    const body = JSON.parse(ackRes.body);
    assert.strictEqual(body.acknowledgedCount, 1);
  });

  test('Clears all notifications for device on DELETE', async () => {
    const notif = {
      id: 'h-del',
      notificationKey: 'key-del',
      deviceId: TEST_DEVICE_ID,
      packageName: 'com.whatsapp',
      appName: 'WhatsApp',
      title: 'Message',
      postedAt: 1000,
      isActive: true
    };

    await handler(createEvent({ method: 'POST', path: '/api/notifications', body: notif }));

    const delRes = await handler(createEvent({
      method: 'DELETE',
      path: '/api/notifications',
      queryStringParameters: { deviceId: TEST_DEVICE_ID }
    }));

    assert.strictEqual(delRes.statusCode, 200);

    const activeRes = await handler(createEvent({
      method: 'GET',
      path: '/api/notifications/active',
      queryStringParameters: { deviceId: TEST_DEVICE_ID }
    }));
    assert.strictEqual(JSON.parse(activeRes.body).count, 0);
  });
});
