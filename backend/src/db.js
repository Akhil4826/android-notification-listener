/**
 * DynamoDB database layer for Phone Reader.
 * Handles storage, TTL expiration, active state tracking, and mock/offline fallback.
 */

const TABLE_NAME = process.env.TABLE_NAME || 'PhoneReaderNotifications';
const DEFAULT_RETENTION_DAYS = 7;

// In-memory store for unit testing and local offline execution
const mockStore = new Map(); // key: `${deviceId}#${notificationKey}` => notification

function getDocClient() {
  if (process.env.USE_MOCK_DB === 'true' || process.env.NODE_ENV === 'test') {
    return null;
  }
  try {
    const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
    const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
    const client = new DynamoDBClient({ region: process.env.AWS_REGION || 'ap-south-1' });
    return DynamoDBDocumentClient.from(client);
  } catch (err) {
    return null;
  }
}

/**
 * Calculate TTL timestamp in epoch seconds.
 */
function calculateTtl(retentionDays = DEFAULT_RETENTION_DAYS) {
  const days = Number(process.env.RETENTION_DAYS || retentionDays);
  return Math.floor(Date.now() / 1000) + days * 86400;
}

/**
 * Upsert a single notification.
 */
async function upsertNotification(notification) {
  const docClient = getDocClient();
  const item = {
    ...notification,
    ttl: calculateTtl()
  };

  if (!docClient) {
    const key = `${item.deviceId}#${item.notificationKey}`;
    mockStore.set(key, item);
    return item;
  }

  const { PutCommand } = require('@aws-sdk/lib-dynamodb');
  await docClient.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: item
  }));

  return item;
}

/**
 * Ingest multiple notifications or perform full active synchronization.
 */
async function batchUpsertNotifications(deviceId, notifications, isFullActiveSync = false) {
  const docClient = getDocClient();

  if (isFullActiveSync) {
    // If full sync, find existing active notifications for this device
    const activeKeysInNewPayload = new Set(notifications.map(n => n.notificationKey));
    const existingActive = await getActiveNotifications(deviceId);

    for (const existing of existingActive) {
      if (!activeKeysInNewPayload.has(existing.notificationKey)) {
        // Mark inactive
        await upsertNotification({
          ...existing,
          isActive: false,
          updatedAt: Date.now(),
          eventType: 'REMOVED'
        });
      }
    }
  }

  const results = [];
  for (const notif of notifications) {
    const saved = await upsertNotification({
      ...notif,
      deviceId
    });
    results.push(saved);
  }

  return results;
}

/**
 * Get active notifications for a device, optionally filtered by application.
 */
async function getActiveNotifications(deviceId, { appFilter = '', limit = 25 } = {}) {
  const docClient = getDocClient();

  if (!docClient) {
    let items = Array.from(mockStore.values()).filter(n => n.deviceId === deviceId && n.isActive === true);

    if (appFilter) {
      const filterLower = appFilter.toLowerCase().trim();
      items = items.filter(n =>
        n.appName.toLowerCase().includes(filterLower) ||
        n.packageName.toLowerCase().includes(filterLower)
      );
    }

    // Sort newest first
    items.sort((a, b) => (b.postedAt || 0) - (a.postedAt || 0));
    return items.slice(0, limit);
  }

  const { QueryCommand } = require('@aws-sdk/lib-dynamodb');
  const response = await docClient.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: 'deviceId = :deviceId',
    FilterExpression: 'isActive = :isActive',
    ExpressionAttributeValues: {
      ':deviceId': deviceId,
      ':isActive': true
    }
  }));

  let items = response.Items || [];

  if (appFilter) {
    const filterLower = appFilter.toLowerCase().trim();
    items = items.filter(n =>
      (n.appName && n.appName.toLowerCase().includes(filterLower)) ||
      (n.packageName && n.packageName.toLowerCase().includes(filterLower))
    );
  }

  items.sort((a, b) => (b.postedAt || 0) - (a.postedAt || 0));
  return items.slice(0, limit);
}

/**
 * Get the single latest active notification for a device.
 */
async function getLatestNotification(deviceId, { appFilter = '' } = {}) {
  const items = await getActiveNotifications(deviceId, { appFilter, limit: 1 });
  return items.length > 0 ? items[0] : null;
}

/**
 * Mark notifications as read by Alexa.
 */
async function acknowledgeNotifications(deviceId, notificationKeys = []) {
  if (!notificationKeys || notificationKeys.length === 0) return 0;
  let ackCount = 0;

  for (const key of notificationKeys) {
    const existing = await getNotificationByKey(deviceId, key);
    if (existing) {
      await upsertNotification({
        ...existing,
        isReadByAlexa: true,
        updatedAt: Date.now()
      });
      ackCount++;
    }
  }

  return ackCount;
}

/**
 * Retrieve a specific notification by deviceId and notificationKey.
 */
async function getNotificationByKey(deviceId, notificationKey) {
  const docClient = getDocClient();
  if (!docClient) {
    return mockStore.get(`${deviceId}#${notificationKey}`) || null;
  }

  const { GetCommand } = require('@aws-sdk/lib-dynamodb');
  const response = await docClient.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: { deviceId, notificationKey }
  }));
  return response.Item || null;
}

/**
 * Clear all data for a specific device (user privacy / wipe request).
 */
async function clearDeviceData(deviceId) {
  const docClient = getDocClient();
  if (!docClient) {
    let deleted = 0;
    for (const [key, val] of mockStore.entries()) {
      if (val.deviceId === deviceId) {
        mockStore.delete(key);
        deleted++;
      }
    }
    return deleted;
  }

  const { QueryCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
  const response = await docClient.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: 'deviceId = :deviceId',
    ExpressionAttributeValues: { ':deviceId': deviceId }
  }));

  const items = response.Items || [];
  for (const item of items) {
    await docClient.send(new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { deviceId: item.deviceId, notificationKey: item.notificationKey }
    }));
  }
  return items.length;
}

function clearMockStore() {
  mockStore.clear();
}

module.exports = {
  upsertNotification,
  batchUpsertNotifications,
  getActiveNotifications,
  getLatestNotification,
  acknowledgeNotifications,
  getNotificationByKey,
  clearDeviceData,
  clearMockStore
};
