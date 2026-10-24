import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import worker from '../src/worker.js';
import { MockD1 } from './mockD1.js';

// Configure test environment
process.env.NODE_ENV = 'test';
const TEST_API_TOKEN = 'test-secret-bearer-token-12345';
const TEST_DEVICE_A = 'device-alpha-111';
const TEST_DEVICE_B = 'device-bravo-222';

const mockDb = new MockD1();
const testEnv = {
  DB: mockDb,
  API_TOKEN: TEST_API_TOKEN,
  RETENTION_DAYS: 7
};

function createRequest({
  method = 'GET',
  path = '/api/health',
  headers = {},
  body = null
}) {
  const url = `https://phone-reader.test${path}`;
  const reqHeaders = new Headers(headers);

  const init = {
    method,
    headers: reqHeaders
  };

  if (body) {
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
  }

  return new Request(url, init);
}

const AUTH_HEADERS = {
  'Authorization': `Bearer ${TEST_API_TOKEN}`,
  'Content-Type': 'application/json'
};

describe('Cloudflare Worker & D1 Test Suite', () => {
  beforeEach(() => {
    mockDb.clear();
  });

  // 1. Health check
  test('Health check endpoint returns 200 without authentication', async () => {
    const req = createRequest({ method: 'GET', path: '/api/health' });
    const res = await worker.fetch(req, testEnv);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.status, 'ok');
    assert.strictEqual(data.service, 'phone-reader-cloudflare-worker');
    assert.ok(data.timestamp > 0);
  });

  // 2. Authentication enforcement
  test('Rejects request with missing authorization header', async () => {
    const req = createRequest({
      method: 'GET',
      path: `/api/notifications/active?deviceId=${TEST_DEVICE_A}`,
      headers: {}
    });
    const res = await worker.fetch(req, testEnv);
    assert.strictEqual(res.status, 401);
  });

  test('Rejects request with invalid token', async () => {
    const req = createRequest({
      method: 'GET',
      path: `/api/notifications/active?deviceId=${TEST_DEVICE_A}`,
      headers: { 'Authorization': 'Bearer wrong-secret-token' }
    });
    const res = await worker.fetch(req, testEnv);
    assert.strictEqual(res.status, 403);
  });

  test('Accepts valid X-Api-Key header', async () => {
    const req = createRequest({
      method: 'GET',
      path: `/api/notifications/active?deviceId=${TEST_DEVICE_A}`,
      headers: { 'x-api-key': TEST_API_TOKEN }
    });
    const res = await worker.fetch(req, testEnv);
    assert.strictEqual(res.status, 200);
  });

  // 3. Device isolation
  test('Enforces device isolation between header and query parameter', async () => {
    const req = createRequest({
      method: 'GET',
      path: `/api/notifications/active?deviceId=${TEST_DEVICE_A}`,
      headers: {
        ...AUTH_HEADERS,
        'x-device-id': TEST_DEVICE_B // Mismatch!
      }
    });
    const res = await worker.fetch(req, testEnv);
    assert.strictEqual(res.status, 403);
    const data = await res.json();
    assert.ok(data.error.includes('Device ID mismatch'));
  });

  test('Guarantees device data boundary (Device A cannot see Device B data)', async () => {
    // Ingest notification for Device A
    await worker.fetch(createRequest({
      method: 'POST',
      path: '/api/notifications',
      headers: { ...AUTH_HEADERS, 'x-device-id': TEST_DEVICE_A },
      body: {
        deviceId: TEST_DEVICE_A,
        notificationKey: 'key-a-1',
        appName: 'WhatsApp',
        text: 'Private message for Alpha'
      }
    }), testEnv);

    // Ingest notification for Device B
    await worker.fetch(createRequest({
      method: 'POST',
      path: '/api/notifications',
      headers: { ...AUTH_HEADERS, 'x-device-id': TEST_DEVICE_B },
      body: {
        deviceId: TEST_DEVICE_B,
        notificationKey: 'key-b-1',
        appName: 'BankAlert',
        text: 'OTP for Bravo'
      }
    }), testEnv);

    // Query active for Device A
    const resA = await worker.fetch(createRequest({
      method: 'GET',
      path: `/api/notifications/active?deviceId=${TEST_DEVICE_A}`,
      headers: AUTH_HEADERS
    }), testEnv);
    const dataA = await resA.json();

    assert.strictEqual(dataA.count, 1);
    assert.strictEqual(dataA.notifications[0].deviceId, TEST_DEVICE_A);
    assert.strictEqual(dataA.notifications[0].text, 'Private message for Alpha');

    // Query active for Device B
    const resB = await worker.fetch(createRequest({
      method: 'GET',
      path: `/api/notifications/active?deviceId=${TEST_DEVICE_B}`,
      headers: AUTH_HEADERS
    }), testEnv);
    const dataB = await resB.json();

    assert.strictEqual(dataB.count, 1);
    assert.strictEqual(dataB.notifications[0].deviceId, TEST_DEVICE_B);
    assert.strictEqual(dataB.notifications[0].text, 'OTP for Bravo');
  });

  // 4. Input validation
  test('Fails on empty body and malformed JSON', async () => {
    const emptyReq = createRequest({
      method: 'POST',
      path: '/api/notifications',
      headers: AUTH_HEADERS,
      body: ''
    });
    const emptyRes = await worker.fetch(emptyReq, testEnv);
    assert.strictEqual(emptyRes.status, 400);

    const malformedReq = createRequest({
      method: 'POST',
      path: '/api/notifications',
      headers: AUTH_HEADERS,
      body: '{ not valid json '
    });
    const malformedRes = await worker.fetch(malformedReq, testEnv);
    assert.strictEqual(malformedRes.status, 400);
  });

  test('Rejects payload exceeding size limit (413)', async () => {
    const hugeText = 'x'.repeat(260 * 1024); // 260 KB > 256 KB limit
    const hugeReq = createRequest({
      method: 'POST',
      path: '/api/notifications',
      headers: AUTH_HEADERS,
      body: { deviceId: TEST_DEVICE_A, notificationKey: 'key-1', text: hugeText }
    });
    const res = await worker.fetch(hugeReq, testEnv);
    assert.strictEqual(res.status, 413);
  });

  // 5. Notification synchronization (single and batch)
  test('Uploads and retrieves a single active notification', async () => {
    const postReq = createRequest({
      method: 'POST',
      path: '/api/notifications',
      headers: { ...AUTH_HEADERS, 'x-device-id': TEST_DEVICE_A },
      body: {
        deviceId: TEST_DEVICE_A,
        notificationKey: 'wa-100',
        packageName: 'com.whatsapp',
        appName: 'WhatsApp',
        title: 'Alice',
        text: 'Hey, are you free for a call?',
        postedAt: 1700000000000
      }
    });

    const postRes = await worker.fetch(postReq, testEnv);
    assert.strictEqual(postRes.status, 200);
    const postData = await postRes.json();
    assert.strictEqual(postData.success, true);
    assert.strictEqual(postData.notificationKey, 'wa-100');

    // Retrieve active
    const getReq = createRequest({
      method: 'GET',
      path: `/api/notifications/active?deviceId=${TEST_DEVICE_A}`,
      headers: AUTH_HEADERS
    });
    const getRes = await worker.fetch(getReq, testEnv);
    assert.strictEqual(getRes.status, 200);
    const getData = await getRes.json();
    assert.strictEqual(getData.count, 1);
    assert.strictEqual(getData.notifications[0].title, 'Alice');
  });

  test('Batch uploads multiple notifications', async () => {
    const batchReq = createRequest({
      method: 'POST',
      path: '/api/notifications',
      headers: { ...AUTH_HEADERS, 'x-device-id': TEST_DEVICE_A },
      body: {
        deviceId: TEST_DEVICE_A,
        notifications: [
          { notificationKey: 'n-1', appName: 'WhatsApp', text: 'Msg 1', postedAt: 100 },
          { notificationKey: 'n-2', appName: 'Instagram', text: 'Msg 2', postedAt: 200 },
          { notificationKey: 'n-3', appName: 'Gmail', text: 'Msg 3', postedAt: 300 }
        ]
      }
    });

    const res = await worker.fetch(batchReq, testEnv);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.count, 3);

    const getRes = await worker.fetch(createRequest({
      method: 'GET',
      path: `/api/notifications/active?deviceId=${TEST_DEVICE_A}`,
      headers: AUTH_HEADERS
    }), testEnv);
    const activeData = await getRes.json();
    assert.strictEqual(activeData.count, 3);
  });

  test('Updates existing notification with newer content (deduplication)', async () => {
    // First post
    await worker.fetch(createRequest({
      method: 'POST',
      path: '/api/notifications',
      headers: { ...AUTH_HEADERS, 'x-device-id': TEST_DEVICE_A },
      body: {
        deviceId: TEST_DEVICE_A,
        notificationKey: 'chat-99',
        appName: 'WhatsApp',
        text: 'Initial message',
        postedAt: 1000
      }
    }), testEnv);

    // Updated post with same key
    await worker.fetch(createRequest({
      method: 'POST',
      path: '/api/notifications',
      headers: { ...AUTH_HEADERS, 'x-device-id': TEST_DEVICE_A },
      body: {
        deviceId: TEST_DEVICE_A,
        notificationKey: 'chat-99',
        appName: 'WhatsApp',
        text: 'Edited / Updated message',
        postedAt: 2000
      }
    }), testEnv);

    const getRes = await worker.fetch(createRequest({
      method: 'GET',
      path: `/api/notifications/active?deviceId=${TEST_DEVICE_A}`,
      headers: AUTH_HEADERS
    }), testEnv);
    const data = await getRes.json();

    assert.strictEqual(data.count, 1);
    assert.strictEqual(data.notifications[0].text, 'Edited / Updated message');
    assert.strictEqual(data.notifications[0].postedAt, 2000);
  });

  test('Handles notification dismissal / removal', async () => {
    // Post active notification
    await worker.fetch(createRequest({
      method: 'POST',
      path: '/api/notifications',
      headers: { ...AUTH_HEADERS, 'x-device-id': TEST_DEVICE_A },
      body: {
        deviceId: TEST_DEVICE_A,
        notificationKey: 'remove-me-key',
        appName: 'WhatsApp',
        text: 'Active now'
      }
    }), testEnv);

    // Verify it is active
    let res = await worker.fetch(createRequest({
      method: 'GET',
      path: `/api/notifications/active?deviceId=${TEST_DEVICE_A}`,
      headers: AUTH_HEADERS
    }), testEnv);
    let data = await res.json();
    assert.strictEqual(data.count, 1);

    // Dismiss notification (eventType = REMOVED, isActive = false)
    await worker.fetch(createRequest({
      method: 'POST',
      path: '/api/notifications',
      headers: { ...AUTH_HEADERS, 'x-device-id': TEST_DEVICE_A },
      body: {
        deviceId: TEST_DEVICE_A,
        notificationKey: 'remove-me-key',
        appName: 'WhatsApp',
        eventType: 'REMOVED',
        isActive: false
      }
    }), testEnv);

    // Verify it no longer appears in active list
    res = await worker.fetch(createRequest({
      method: 'GET',
      path: `/api/notifications/active?deviceId=${TEST_DEVICE_A}`,
      headers: AUTH_HEADERS
    }), testEnv);
    data = await res.json();
    assert.strictEqual(data.count, 0);
  });

  test('Full active synchronization reconciles disappeared notifications', async () => {
    // Initial sync with 2 items
    await worker.fetch(createRequest({
      method: 'POST',
      path: '/api/notifications',
      headers: { ...AUTH_HEADERS, 'x-device-id': TEST_DEVICE_A },
      body: {
        deviceId: TEST_DEVICE_A,
        isFullActiveSync: true,
        notifications: [
          { notificationKey: 'notif-1', appName: 'App1', text: 'Text 1' },
          { notificationKey: 'notif-2', appName: 'App2', text: 'Text 2' }
        ]
      }
    }), testEnv);

    // Subsequent full sync with only notif-2 (notif-1 dismissed by user on phone)
    await worker.fetch(createRequest({
      method: 'POST',
      path: '/api/notifications',
      headers: { ...AUTH_HEADERS, 'x-device-id': TEST_DEVICE_A },
      body: {
        deviceId: TEST_DEVICE_A,
        isFullActiveSync: true,
        notifications: [
          { notificationKey: 'notif-2', appName: 'App2', text: 'Text 2 Updated' }
        ]
      }
    }), testEnv);

    const getRes = await worker.fetch(createRequest({
      method: 'GET',
      path: `/api/notifications/active?deviceId=${TEST_DEVICE_A}`,
      headers: AUTH_HEADERS
    }), testEnv);
    const data = await getRes.json();

    assert.strictEqual(data.count, 1);
    assert.strictEqual(data.notifications[0].notificationKey, 'notif-2');
  });

  // 6. App-specific filtering
  test('Filters active notifications by app name (WhatsApp, Instagram)', async () => {
    await worker.fetch(createRequest({
      method: 'POST',
      path: '/api/notifications',
      headers: { ...AUTH_HEADERS, 'x-device-id': TEST_DEVICE_A },
      body: {
        deviceId: TEST_DEVICE_A,
        notifications: [
          { notificationKey: 'wa-1', appName: 'WhatsApp', text: 'WhatsApp msg 1', postedAt: 300 },
          { notificationKey: 'wa-2', appName: 'WhatsApp', text: 'WhatsApp msg 2', postedAt: 200 },
          { notificationKey: 'ig-1', appName: 'Instagram', text: 'Instagram direct msg', postedAt: 400 },
          { notificationKey: 'gm-1', appName: 'Gmail', text: 'Newsletter', postedAt: 100 }
        ]
      }
    }), testEnv);

    // Query for WhatsApp (case-insensitive)
    const waRes = await worker.fetch(createRequest({
      method: 'GET',
      path: `/api/notifications/active?deviceId=${TEST_DEVICE_A}&app=whatsapp`,
      headers: AUTH_HEADERS
    }), testEnv);
    const waData = await waRes.json();
    assert.strictEqual(waData.count, 2);
    assert.ok(waData.notifications.every(n => n.appName === 'WhatsApp'));

    // Query for WhatsApp using alias "whats app notifications"
    const waAliasRes = await worker.fetch(createRequest({
      method: 'GET',
      path: `/api/notifications/active?deviceId=${TEST_DEVICE_A}&app=whats%20app%20notifications`,
      headers: AUTH_HEADERS
    }), testEnv);
    const waAliasData = await waAliasRes.json();
    assert.strictEqual(waAliasData.count, 2);

    // Query for WhatsApp using misspelling "watsapp"
    const waTypoRes = await worker.fetch(createRequest({
      method: 'GET',
      path: `/api/notifications/active?deviceId=${TEST_DEVICE_A}&app=watsapp`,
      headers: AUTH_HEADERS
    }), testEnv);
    const waTypoData = await waTypoRes.json();
    assert.strictEqual(waTypoData.count, 2);

    // Query for Instagram using short alias "insta"
    const igRes = await worker.fetch(createRequest({
      method: 'GET',
      path: `/api/notifications/active?deviceId=${TEST_DEVICE_A}&app=insta`,
      headers: AUTH_HEADERS
    }), testEnv);
    const igData = await igRes.json();
    assert.strictEqual(igData.count, 1);
    assert.strictEqual(igData.notifications[0].notificationKey, 'ig-1');
  });

  // 7. Latest notification retrieval
  test('Retrieves the latest notification correctly', async () => {
    await worker.fetch(createRequest({
      method: 'POST',
      path: '/api/notifications',
      headers: { ...AUTH_HEADERS, 'x-device-id': TEST_DEVICE_A },
      body: {
        deviceId: TEST_DEVICE_A,
        notifications: [
          { notificationKey: 'old-1', appName: 'Slack', text: 'Old message', postedAt: 1000 },
          { notificationKey: 'new-2', appName: 'WhatsApp', text: 'Brand new message', postedAt: 9999 }
        ]
      }
    }), testEnv);

    const latestRes = await worker.fetch(createRequest({
      method: 'GET',
      path: `/api/notifications/latest?deviceId=${TEST_DEVICE_A}`,
      headers: AUTH_HEADERS
    }), testEnv);
    const latestData = await latestRes.json();

    assert.strictEqual(latestData.hasNotification, true);
    assert.strictEqual(latestData.notification.notificationKey, 'new-2');
    assert.strictEqual(latestData.notification.text, 'Brand new message');
  });

  // 8. Active notification count
  test('Returns notification count total and grouped by app', async () => {
    await worker.fetch(createRequest({
      method: 'POST',
      path: '/api/notifications',
      headers: { ...AUTH_HEADERS, 'x-device-id': TEST_DEVICE_A },
      body: {
        deviceId: TEST_DEVICE_A,
        notifications: [
          { notificationKey: 'wa-1', appName: 'WhatsApp', text: 'W1', postedAt: 10 },
          { notificationKey: 'wa-2', appName: 'WhatsApp', text: 'W2', postedAt: 20 },
          { notificationKey: 'ig-1', appName: 'Instagram', text: 'I1', postedAt: 30 }
        ]
      }
    }), testEnv);

    const countRes = await worker.fetch(createRequest({
      method: 'GET',
      path: `/api/notifications/count?deviceId=${TEST_DEVICE_A}`,
      headers: AUTH_HEADERS
    }), testEnv);
    const countData = await countRes.json();

    assert.strictEqual(countData.total, 3);
    assert.strictEqual(countData.byApp['WhatsApp'], 2);
    assert.strictEqual(countData.byApp['Instagram'], 1);
  });

  // 9. Acknowledge notifications
  test('Acknowledges notifications as read', async () => {
    await worker.fetch(createRequest({
      method: 'POST',
      path: '/api/notifications',
      headers: { ...AUTH_HEADERS, 'x-device-id': TEST_DEVICE_A },
      body: {
        deviceId: TEST_DEVICE_A,
        notificationKey: 'read-key-1',
        appName: 'WhatsApp',
        text: 'Unread message'
      }
    }), testEnv);

    const ackRes = await worker.fetch(createRequest({
      method: 'POST',
      path: '/api/notifications/ack',
      headers: { ...AUTH_HEADERS, 'x-device-id': TEST_DEVICE_A },
      body: {
        deviceId: TEST_DEVICE_A,
        notificationKeys: ['read-key-1']
      }
    }), testEnv);
    const ackData = await ackRes.json();
    assert.strictEqual(ackData.success, true);
    assert.strictEqual(ackData.acknowledgedCount, 1);
  });

  // 10. Clear notifications
  test('Clears all notifications for device on DELETE', async () => {
    await worker.fetch(createRequest({
      method: 'POST',
      path: '/api/notifications',
      headers: { ...AUTH_HEADERS, 'x-device-id': TEST_DEVICE_A },
      body: {
        deviceId: TEST_DEVICE_A,
        notificationKey: 'delete-key-1',
        appName: 'WhatsApp',
        text: 'To be deleted'
      }
    }), testEnv);

    const delRes = await worker.fetch(createRequest({
      method: 'DELETE',
      path: `/api/notifications?deviceId=${TEST_DEVICE_A}`,
      headers: AUTH_HEADERS
    }), testEnv);
    const delData = await delRes.json();
    assert.strictEqual(delData.success, true);
    assert.strictEqual(delData.deletedCount, 1);

    const getRes = await worker.fetch(createRequest({
      method: 'GET',
      path: `/api/notifications/active?deviceId=${TEST_DEVICE_A}`,
      headers: AUTH_HEADERS
    }), testEnv);
    const getData = await getRes.json();
    assert.strictEqual(getData.count, 0);
  });

  // 11. Pagination & Limits
  test('Respects limit parameter for pagination', async () => {
    const list = [];
    for (let i = 1; i <= 10; i++) {
      list.push({
        notificationKey: `pag-key-${i}`,
        appName: 'TestApp',
        text: `Message ${i}`,
        postedAt: i * 100
      });
    }

    await worker.fetch(createRequest({
      method: 'POST',
      path: '/api/notifications',
      headers: { ...AUTH_HEADERS, 'x-device-id': TEST_DEVICE_A },
      body: { deviceId: TEST_DEVICE_A, notifications: list }
    }), testEnv);

    const res = await worker.fetch(createRequest({
      method: 'GET',
      path: `/api/notifications/active?deviceId=${TEST_DEVICE_A}&limit=3`,
      headers: AUTH_HEADERS
    }), testEnv);
    const data = await res.json();

    assert.strictEqual(data.count, 3);
    assert.strictEqual(data.notifications.length, 3);
    // Should be newest first (postedAt 1000, 900, 800)
    assert.strictEqual(data.notifications[0].notificationKey, 'pag-key-10');
    assert.strictEqual(data.notifications[1].notificationKey, 'pag-key-9');
    assert.strictEqual(data.notifications[2].notificationKey, 'pag-key-8');
  });

  // 12. Settings and DND endpoints
  test('Reads and updates device settings (DND and priority apps)', async () => {
    // Default settings
    const getRes = await worker.fetch(createRequest({
      method: 'GET',
      path: `/api/settings?deviceId=${TEST_DEVICE_A}`,
      headers: AUTH_HEADERS
    }), testEnv);
    assert.strictEqual(getRes.status, 200);
    const getData = await getRes.json();
    assert.strictEqual(getData.settings.dndEnabled, false);
    assert.ok(Array.isArray(getData.settings.priorityApps));

    // Update settings: enable DND and set priority apps to WhatsApp and Messages
    const postRes = await worker.fetch(createRequest({
      method: 'POST',
      path: '/api/settings',
      headers: { ...AUTH_HEADERS, 'x-device-id': TEST_DEVICE_A },
      body: {
        deviceId: TEST_DEVICE_A,
        dndEnabled: true,
        priorityApps: ['WhatsApp', 'Messages']
      }
    }), testEnv);
    assert.strictEqual(postRes.status, 200);
    const postData = await postRes.json();
    assert.strictEqual(postData.settings.dndEnabled, true);
    assert.deepStrictEqual(postData.settings.priorityApps, ['WhatsApp', 'Messages']);

    // Verify GET reflects the update
    const verifyRes = await worker.fetch(createRequest({
      method: 'GET',
      path: `/api/settings?deviceId=${TEST_DEVICE_A}`,
      headers: AUTH_HEADERS
    }), testEnv);
    const verifyData = await verifyRes.json();
    assert.strictEqual(verifyData.settings.dndEnabled, true);
    assert.deepStrictEqual(verifyData.settings.priorityApps, ['WhatsApp', 'Messages']);
  });

  // 13. Sender filtering
  test('Filters active notifications by sender (title or subtext)', async () => {
    await worker.fetch(createRequest({
      method: 'POST',
      path: '/api/notifications',
      headers: { ...AUTH_HEADERS, 'x-device-id': TEST_DEVICE_A },
      body: {
        deviceId: TEST_DEVICE_A,
        notifications: [
          { notificationKey: 's-1', appName: 'WhatsApp', title: 'Mom', text: 'Call me when free', postedAt: 300 },
          { notificationKey: 's-2', appName: 'WhatsApp', title: 'Rahul Sharma', text: 'Are you coming?', postedAt: 200 },
          { notificationKey: 's-3', appName: 'Messages', title: 'HDFC Bank', text: 'Your OTP is 492018', postedAt: 100 }
        ]
      }
    }), testEnv);

    // Search for Mom
    const momRes = await worker.fetch(createRequest({
      method: 'GET',
      path: `/api/notifications/active?deviceId=${TEST_DEVICE_A}&sender=mom`,
      headers: AUTH_HEADERS
    }), testEnv);
    const momData = await momRes.json();
    assert.strictEqual(momData.count, 1);
    assert.strictEqual(momData.notifications[0].title, 'Mom');

    // Search for Rahul
    const rahulRes = await worker.fetch(createRequest({
      method: 'GET',
      path: `/api/notifications/active?deviceId=${TEST_DEVICE_A}&sender=rahul`,
      headers: AUTH_HEADERS
    }), testEnv);
    const rahulData = await rahulRes.json();
    assert.strictEqual(rahulData.count, 1);
    assert.strictEqual(rahulData.notifications[0].title, 'Rahul Sharma');
  });

  // 14. App-specific deletion
  test('Clears only notifications for specific app when app parameter is provided on DELETE', async () => {
    await worker.fetch(createRequest({
      method: 'POST',
      path: '/api/notifications',
      headers: { ...AUTH_HEADERS, 'x-device-id': TEST_DEVICE_A },
      body: {
        deviceId: TEST_DEVICE_A,
        notifications: [
          { notificationKey: 'wa-del-1', appName: 'WhatsApp', text: 'Msg 1', postedAt: 100 },
          { notificationKey: 'ig-keep-1', appName: 'Instagram', text: 'Photo like', postedAt: 200 }
        ]
      }
    }), testEnv);

    // Delete only WhatsApp
    const delRes = await worker.fetch(createRequest({
      method: 'DELETE',
      path: `/api/notifications?deviceId=${TEST_DEVICE_A}&app=whatsapp`,
      headers: AUTH_HEADERS
    }), testEnv);
    const delData = await delRes.json();
    assert.strictEqual(delData.success, true);
    assert.strictEqual(delData.deletedCount, 1);

    // Verify WhatsApp deleted but Instagram remains
    const getRes = await worker.fetch(createRequest({
      method: 'GET',
      path: `/api/notifications/active?deviceId=${TEST_DEVICE_A}`,
      headers: AUTH_HEADERS
    }), testEnv);
    const getData = await getRes.json();
    assert.strictEqual(getData.count, 1);
    assert.strictEqual(getData.notifications[0].appName, 'Instagram');
  });

  // 15. Phone status & sync heartbeat
  test('Returns phone health and sync heartbeat status', async () => {
    const statusRes = await worker.fetch(createRequest({
      method: 'GET',
      path: `/api/status?deviceId=${TEST_DEVICE_A}`,
      headers: AUTH_HEADERS
    }), testEnv);
    assert.strictEqual(statusRes.status, 200);
    const statusData = await statusRes.json();
    assert.strictEqual(statusData.success, true);
    assert.strictEqual(statusData.deviceId, TEST_DEVICE_A);
    assert.ok(typeof statusData.status.isHealthy === 'boolean');
    assert.ok(typeof statusData.status.activeCount === 'number');
  });

  // 16. Secret key verification and update
  test('Verifies secret key and allows user to update it', async () => {
    // Verify default secret key 4826
    const verifyRes = await worker.fetch(createRequest({
      method: 'POST',
      path: '/api/settings/secret-key/verify',
      headers: AUTH_HEADERS,
      body: { deviceId: TEST_DEVICE_A, key: '4826' }
    }), testEnv);
    assert.strictEqual(verifyRes.status, 200);
    const verifyData = await verifyRes.json();
    assert.strictEqual(verifyData.valid, true);

    // Verify incorrect secret key fails
    const badVerifyRes = await worker.fetch(createRequest({
      method: 'POST',
      path: '/api/settings/secret-key/verify',
      headers: AUTH_HEADERS,
      body: { deviceId: TEST_DEVICE_A, key: '0000' }
    }), testEnv);
    const badVerifyData = await badVerifyRes.json();
    assert.strictEqual(badVerifyData.valid, false);

    // Update secret key to 9999 with valid old key
    const updateRes = await worker.fetch(createRequest({
      method: 'POST',
      path: '/api/settings/secret-key',
      headers: AUTH_HEADERS,
      body: { deviceId: TEST_DEVICE_A, oldKey: '4826', newKey: '9999' }
    }), testEnv);
    assert.strictEqual(updateRes.status, 200);
    const updateData = await updateRes.json();
    assert.strictEqual(updateData.success, true);

    // Verify new secret key 9999 works
    const newVerifyRes = await worker.fetch(createRequest({
      method: 'POST',
      path: '/api/settings/secret-key/verify',
      headers: AUTH_HEADERS,
      body: { deviceId: TEST_DEVICE_A, key: '9999' }
    }), testEnv);
    const newVerifyData = await newVerifyRes.json();
    assert.strictEqual(newVerifyData.valid, true);

    // Reset back to 4826 for other tests
    await worker.fetch(createRequest({
      method: 'POST',
      path: '/api/settings/secret-key',
      headers: AUTH_HEADERS,
      body: { deviceId: TEST_DEVICE_A, oldKey: '9999', newKey: '4826' }
    }), testEnv);
  });

  // 17. Message reply strictly protected by secret key
  test('Requires valid secret key to queue reply action', async () => {
    // Attempt reply with wrong secret key - should be rejected with 403
    const badReplyRes = await worker.fetch(createRequest({
      method: 'POST',
      path: '/api/actions/reply',
      headers: AUTH_HEADERS,
      body: {
        deviceId: TEST_DEVICE_A,
        secretKey: '1234',
        senderName: 'Mom',
        appName: 'WhatsApp',
        replyText: 'I will be there in 10 minutes.'
      }
    }), testEnv);
    assert.strictEqual(badReplyRes.status, 403);
    const badReplyData = await badReplyRes.json();
    assert.strictEqual(badReplyData.error, 'INCORRECT_SECRET_KEY');

    // Attempt reply with correct secret key 4826 - should succeed
    const goodReplyRes = await worker.fetch(createRequest({
      method: 'POST',
      path: '/api/actions/reply',
      headers: AUTH_HEADERS,
      body: {
        deviceId: TEST_DEVICE_A,
        secretKey: '4826',
        senderName: 'Mom',
        appName: 'WhatsApp',
        replyText: 'I will be there in 10 minutes.'
      }
    }), testEnv);
    assert.strictEqual(goodReplyRes.status, 200);
    const goodReplyData = await goodReplyRes.json();
    assert.strictEqual(goodReplyData.success, true);
    assert.ok(goodReplyData.actionId.startsWith('act_'));

    // Verify pending action can be retrieved by Android app
    const pendingRes = await worker.fetch(createRequest({
      method: 'GET',
      path: `/api/actions/pending?deviceId=${TEST_DEVICE_A}`,
      headers: AUTH_HEADERS
    }), testEnv);
    const pendingData = await pendingRes.json();
    assert.strictEqual(pendingData.success, true);
    assert.ok(pendingData.actions.length >= 1);
    const action = pendingData.actions.find(a => a.id === goodReplyData.actionId);
    assert.strictEqual(action.actionType, 'REPLY');
    assert.strictEqual(action.targetSender, 'Mom');
    assert.strictEqual(action.payload, 'I will be there in 10 minutes.');

    // Complete the action
    const compRes = await worker.fetch(createRequest({
      method: 'POST',
      path: `/api/actions/${goodReplyData.actionId}/complete`,
      headers: AUTH_HEADERS,
      body: { deviceId: TEST_DEVICE_A, success: true }
    }), testEnv);
    const compData = await compRes.json();
    assert.strictEqual(compData.success, true);
    assert.strictEqual(compData.result.status, 'EXECUTED');
  });

  // 18. Battery, charging, and hardware status
  test('Updates and retrieves battery level and charging status', async () => {
    const postStatusRes = await worker.fetch(createRequest({
      method: 'POST',
      path: '/api/status',
      headers: AUTH_HEADERS,
      body: {
        deviceId: TEST_DEVICE_A,
        batteryLevel: 82,
        isCharging: true,
        chargingType: 'AC',
        ringerMode: 'NORMAL'
      }
    }), testEnv);
    assert.strictEqual(postStatusRes.status, 200);

    const getStatusRes = await worker.fetch(createRequest({
      method: 'GET',
      path: `/api/status?deviceId=${TEST_DEVICE_A}`,
      headers: AUTH_HEADERS
    }), testEnv);
    const statusData = await getStatusRes.json();
    assert.strictEqual(statusData.status.batteryLevel, 82);
    assert.strictEqual(statusData.status.isCharging, true);
    assert.strictEqual(statusData.status.chargingType, 'AC');
  });

  // 19. Missed calls and daily briefing
  test('Retrieves missed calls and consolidated daily briefing', async () => {
    // Add a missed call notification
    await worker.fetch(createRequest({
      method: 'POST',
      path: '/api/notifications',
      headers: { ...AUTH_HEADERS, 'x-device-id': TEST_DEVICE_A },
      body: {
        deviceId: TEST_DEVICE_A,
        notifications: [
          {
            notificationKey: 'call-1',
            appName: 'Phone',
            category: 'missed_call',
            title: 'Dad',
            text: 'Missed call from Dad',
            postedAt: Date.now() - 300000
          }
        ]
      }
    }), testEnv);

    // Query missed calls
    const callRes = await worker.fetch(createRequest({
      method: 'GET',
      path: `/api/notifications/missed-calls?deviceId=${TEST_DEVICE_A}`,
      headers: AUTH_HEADERS
    }), testEnv);
    const callData = await callRes.json();
    assert.strictEqual(callData.success, true);
    assert.ok(callData.count >= 1);
    assert.strictEqual(callData.missedCalls[0].title, 'Dad');

    // Query daily briefing
    const briefRes = await worker.fetch(createRequest({
      method: 'GET',
      path: `/api/briefing?deviceId=${TEST_DEVICE_A}`,
      headers: AUTH_HEADERS
    }), testEnv);
    const briefData = await briefRes.json();
    assert.strictEqual(briefData.success, true);
    assert.ok(briefData.briefing.batteryLevel >= 0);
    assert.ok(typeof briefData.briefing.totalActiveNotifications === 'number');
  });

  // 20. Quota & Usage Dashboard
  test('Returns Cloudflare D1 & Workers quota metrics with free tier allocations', async () => {
    const res = await worker.fetch(createRequest({
      method: 'GET',
      path: `/api/quota?deviceId=${TEST_DEVICE_A}`,
      headers: AUTH_HEADERS
    }), testEnv);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.d1Reads.quota, 5000000);
    assert.strictEqual(data.d1Writes.quota, 100000);
    assert.strictEqual(data.workersRequests.quota, 100000);
    assert.strictEqual(data.cost.currentMonthlyUsd, 0.00);
    assert.ok(typeof data.d1Reads.used === 'number');
    assert.ok(typeof data.d1Writes.used === 'number');
  });

  // 21. 404 handler
  test('Returns 404 for unknown route', async () => {
    const res = await worker.fetch(createRequest({
      method: 'GET',
      path: '/api/unknown-endpoint',
      headers: AUTH_HEADERS
    }), testEnv);
    assert.strictEqual(res.status, 404);
  });
});

