/**
 * Cloudflare D1 Database Access Layer for Phone Reader.
 * Implements SQLite prepared statements with parameter binding and batching.
 */

import { isAppMatch } from './appMatcher.js';
import { isContactMatch } from './contactMatcher.js';

/**
 * Upsert a single notification.
 *
 * @param {Object} db - Cloudflare D1 binding (env.DB)
 * @param {Object} notification - Sanitized notification object
 * @returns {Promise<Object>}
 */
async function upsertNotification(db, notification) {
  const sql = `
    INSERT INTO notifications (
      deviceId, notificationKey, packageName, appName, title, text, bigText, subText, category,
      postedAt, updatedAt, lastSeenAt, isActive, isReadByAlexa, contentAvailable, eventType
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(deviceId, notificationKey) DO UPDATE SET
      packageName = excluded.packageName,
      appName = excluded.appName,
      title = excluded.title,
      text = excluded.text,
      bigText = excluded.bigText,
      subText = excluded.subText,
      category = excluded.category,
      postedAt = excluded.postedAt,
      updatedAt = excluded.updatedAt,
      lastSeenAt = excluded.lastSeenAt,
      isActive = excluded.isActive,
      contentAvailable = excluded.contentAvailable,
      eventType = excluded.eventType;
  `;

  const stmt = db.prepare(sql).bind(
    notification.deviceId,
    notification.notificationKey,
    notification.packageName || '',
    notification.appName || 'Unknown App',
    notification.title || '',
    notification.text || '',
    notification.bigText || '',
    notification.subText || '',
    notification.category || '',
    notification.postedAt || Date.now(),
    notification.updatedAt || Date.now(),
    notification.lastSeenAt || Date.now(),
    notification.isActive ? 1 : 0,
    notification.isReadByAlexa ? 1 : 0,
    notification.contentAvailable ? 1 : 0,
    notification.eventType || 'POSTED'
  );

  await stmt.run();
  return notification;
}

/**
 * Batch upsert notifications with optional full-active sync reconciliation.
 *
 * @param {Object} db - Cloudflare D1 binding
 * @param {string} deviceId - Device ID
 * @param {Array<Object>} notifications - List of sanitized notification objects
 * @param {boolean} isFullActiveSync - If true, reconciles inactive state for missing items
 * @returns {Promise<Array<Object>>}
 */
async function batchUpsertNotifications(db, deviceId, notifications, isFullActiveSync = false) {
  const statements = [];

  // If this is a full active sync from the Android device,
  // mark all existing notifications for this device as inactive first.
  if (isFullActiveSync) {
    statements.push(
      db.prepare('UPDATE notifications SET isActive = 0 WHERE deviceId = ?').bind(deviceId)
    );
  }

  const upsertSql = `
    INSERT INTO notifications (
      deviceId, notificationKey, packageName, appName, title, text, bigText, subText, category,
      postedAt, updatedAt, lastSeenAt, isActive, isReadByAlexa, contentAvailable, eventType
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(deviceId, notificationKey) DO UPDATE SET
      packageName = excluded.packageName,
      appName = excluded.appName,
      title = excluded.title,
      text = excluded.text,
      bigText = excluded.bigText,
      subText = excluded.subText,
      category = excluded.category,
      postedAt = excluded.postedAt,
      updatedAt = excluded.updatedAt,
      lastSeenAt = excluded.lastSeenAt,
      isActive = excluded.isActive,
      contentAvailable = excluded.contentAvailable,
      eventType = excluded.eventType;
  `;

  for (const n of notifications) {
    statements.push(
      db.prepare(upsertSql).bind(
        deviceId,
        n.notificationKey,
        n.packageName || '',
        n.appName || 'Unknown App',
        n.title || '',
        n.text || '',
        n.bigText || '',
        n.subText || '',
        n.category || '',
        n.postedAt || Date.now(),
        n.updatedAt || Date.now(),
        n.lastSeenAt || Date.now(),
        n.isActive ? 1 : 0,
        n.isReadByAlexa ? 1 : 0,
        n.contentAvailable ? 1 : 0,
        n.eventType || 'POSTED'
      )
    );
  }

  if (statements.length > 0) {
    await db.batch(statements);
  }

  return notifications;
}

/**
 * Retrieve active notifications for a device, with optional intelligent app and sender filtering.
 *
 * @param {Object} db - Cloudflare D1 binding
 * @param {string} deviceId - Device ID
 * @param {Object} options - { appFilter, sender, limit }
 * @returns {Promise<Array<Object>>}
 */
async function getActiveNotifications(db, deviceId, { appFilter = '', sender = '', limit = 10 } = {}) {
  const sql = `
    SELECT * FROM notifications 
    WHERE deviceId = ? AND isActive = 1
    ORDER BY postedAt DESC LIMIT 100
  `;

  const result = await db.prepare(sql).bind(deviceId).all();
  let rows = (result && result.results) || [];

  // If app filter is requested, apply intelligent fuzzy + alias matching
  if (appFilter && appFilter.trim().length > 0) {
    const filterTerm = appFilter.trim();
    rows = rows.filter(r =>
      isAppMatch(r.appName || '', filterTerm) ||
      isAppMatch(r.packageName || '', filterTerm)
    );
  }

  // If sender filter is requested, match using intelligent contact & alias matcher
  if (sender && sender.trim().length > 0) {
    const filterSender = sender.trim();
    rows = rows.filter(r =>
      isContactMatch(r.title || '', r.subText || '', (r.text || '') + ' ' + (r.bigText || ''), filterSender)
    );
  }

  // Filter out phantom empty rows
  rows = rows.filter(r => (r.title || '').trim().length > 0 || (r.text || '').trim().length > 0 || (r.bigText || '').trim().length > 0);

  // Content Deduplication: if multiple active notifications have the same app, sender/title, and message body, keep only the latest one
  const seenContent = new Set();
  const dedupedRows = [];
  for (const r of rows) {
    const app = (r.appName || r.packageName || '').toLowerCase().trim();
    const senderName = (r.title || '').trim();
    const content = (r.text || r.bigText || '').trim();
    const contentKey = `${app}:::${senderName}:::${content}`;
    if (content.length > 0) {
      if (seenContent.has(contentKey)) {
        continue;
      }
      seenContent.add(contentKey);
    }
    dedupedRows.push(r);
  }
  rows = dedupedRows;

  const effectiveLimit = Math.min(Math.max(limit, 1), 50);
  rows = rows.slice(0, effectiveLimit);

  return rows.map(r => ({
    ...r,
    isActive: Boolean(r.isActive),
    isReadByAlexa: Boolean(r.isReadByAlexa),
    contentAvailable: Boolean(r.contentAvailable)
  }));
}

/**
 * Retrieve the single newest active notification for a device.
 *
 * @param {Object} db - Cloudflare D1 binding
 * @param {string} deviceId - Device ID
 * @param {Object} options - { appFilter }
 * @returns {Promise<Object|null>}
 */
async function getLatestNotification(db, deviceId, { appFilter = '' } = {}) {
  const items = await getActiveNotifications(db, deviceId, { appFilter, limit: 1 });
  return items.length > 0 ? items[0] : null;
}

/**
 * Count active notifications for a device, both total and grouped by app.
 *
 * @param {Object} db - Cloudflare D1 binding
 * @param {string} deviceId - Device ID
 * @returns {Promise<{ total: number, byApp: Record<string, number> }>}
 */
async function countNotifications(db, deviceId) {
  const totalResult = await db.prepare(
    'SELECT COUNT(*) as total FROM notifications WHERE deviceId = ? AND isActive = 1'
  ).bind(deviceId).first();

  const total = Number((totalResult && totalResult.total) || 0);

  const groupResult = await db.prepare(
    'SELECT appName, COUNT(*) as appCount FROM notifications WHERE deviceId = ? AND isActive = 1 GROUP BY appName'
  ).bind(deviceId).all();

  const byApp = {};
  const rows = (groupResult && groupResult.results) || [];
  for (const r of rows) {
    byApp[r.appName] = Number(r.appCount || 0);
  }

  return { total, byApp };
}

/**
 * Mark specified notification keys as read.
 *
 * @param {Object} db - Cloudflare D1 binding
 * @param {string} deviceId - Device ID
 * @param {Array<string>} notificationKeys - Keys to mark as read
 * @returns {Promise<number>} Number of updated rows
 */
async function acknowledgeNotifications(db, deviceId, notificationKeys) {
  if (!Array.isArray(notificationKeys) || notificationKeys.length === 0) {
    return 0;
  }

  const statements = notificationKeys.map(k =>
    db.prepare('UPDATE notifications SET isReadByAlexa = 1 WHERE deviceId = ? AND notificationKey = ?').bind(deviceId, k)
  );

  const results = await db.batch(statements);
  return results.length;
}

/**
 * Clear stored notifications for a device, optionally scoped to a specific app.
 *
 * @param {Object} db - Cloudflare D1 binding
 * @param {string} deviceId - Device ID
 * @param {Object} options - { appFilter }
 * @returns {Promise<number>}
 */
async function clearDeviceData(db, deviceId, { appFilter = '' } = {}) {
  if (appFilter && appFilter.trim().length > 0) {
    const active = await getActiveNotifications(db, deviceId, { appFilter, limit: 100 });
    if (active.length === 0) return 0;
    const statements = active.map(n =>
      db.prepare('DELETE FROM notifications WHERE deviceId = ? AND notificationKey = ?').bind(deviceId, n.notificationKey)
    );
    const res = await db.batch(statements);
    return res.length;
  }

  const res = await db.prepare('DELETE FROM notifications WHERE deviceId = ?').bind(deviceId).run();
  return (res && res.meta && res.meta.changes) || 0;
}

/**
 * Retrieve phone connection status, battery, and sync heartbeat.
 *
 * @param {Object} db - Cloudflare D1 binding
 * @param {string} deviceId - Device ID
 * @returns {Promise<Object>}
 */
async function getDeviceStatus(db, deviceId) {
  const row = await db.prepare(
    'SELECT MAX(updatedAt) as lastUpdatedAt, MAX(postedAt) as lastPostedAt, COUNT(*) as totalStored FROM notifications WHERE deviceId = ?'
  ).bind(deviceId).first();

  const activeResult = await db.prepare(
    'SELECT COUNT(*) as activeCount FROM notifications WHERE deviceId = ? AND isActive = 1'
  ).bind(deviceId).first();

  const statusRow = await db.prepare(
    'SELECT batteryLevel, isCharging, chargingType, isPowerSave, ringerMode, isPhoneRinging, lastSeenAt FROM device_status WHERE deviceId = ?'
  ).bind(deviceId).first();

  const lastSyncTime = Number((row && (row.lastUpdatedAt || row.lastPostedAt)) || 0);
  const activeCount = Number((activeResult && activeResult.activeCount) || 0);
  const totalStored = Number((row && row.totalStored) || 0);

  return {
    deviceId,
    lastSyncTime,
    activeCount,
    totalStored,
    isHealthy: lastSyncTime > 0 && (Date.now() - lastSyncTime < 2 * 60 * 60 * 1000),
    batteryLevel: statusRow ? Number(statusRow.batteryLevel) : 100,
    isCharging: statusRow ? Boolean(statusRow.isCharging) : false,
    chargingType: (statusRow && statusRow.chargingType) || 'NONE',
    isPowerSave: statusRow ? Boolean(statusRow.isPowerSave) : false,
    ringerMode: (statusRow && statusRow.ringerMode) || 'NORMAL',
    isPhoneRinging: statusRow ? Boolean(statusRow.isPhoneRinging) : false,
    deviceLastSeenAt: (statusRow && statusRow.lastSeenAt) || lastSyncTime
  };
}

/**
 * Upsert device battery and hardware status from Android client.
 */
async function upsertDeviceStatus(db, deviceId, {
  batteryLevel = 100,
  isCharging = false,
  chargingType = 'NONE',
  isPowerSave = false,
  ringerMode = 'NORMAL',
  isPhoneRinging = false
} = {}) {
  const sql = `
    INSERT INTO device_status (
      deviceId, batteryLevel, isCharging, chargingType, isPowerSave, ringerMode, isPhoneRinging, lastSeenAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(deviceId) DO UPDATE SET
      batteryLevel = excluded.batteryLevel,
      isCharging = excluded.isCharging,
      chargingType = excluded.chargingType,
      isPowerSave = excluded.isPowerSave,
      ringerMode = excluded.ringerMode,
      isPhoneRinging = excluded.isPhoneRinging,
      lastSeenAt = excluded.lastSeenAt;
  `;

  await db.prepare(sql).bind(
    deviceId,
    Number(batteryLevel) || 100,
    isCharging ? 1 : 0,
    chargingType || 'NONE',
    isPowerSave ? 1 : 0,
    ringerMode || 'NORMAL',
    isPhoneRinging ? 1 : 0,
    Date.now()
  ).run();

  return getDeviceStatus(db, deviceId);
}

/**
 * Prune stale notifications older than retention threshold and dismissed notifications older than 24h.
 *
 * @param {Object} db - Cloudflare D1 binding
 * @param {number} retentionDays - Retention window in days
 * @returns {Promise<number>}
 */
async function pruneOldNotifications(db, retentionDays = 7) {
  const cutoffTime = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);
  const inactiveCutoff = Date.now() - (24 * 60 * 60 * 1000); // 24 hours for dismissed notifications

  const res = await db.prepare(
    'DELETE FROM notifications WHERE postedAt < ? OR (isActive = 0 AND updatedAt < ?)'
  ).bind(cutoffTime, inactiveCutoff).run();

  // Also prune executed or expired device actions older than 48 hours
  const actionCutoff = Date.now() - (48 * 60 * 60 * 1000);
  await db.prepare('DELETE FROM device_actions WHERE createdAt < ?').bind(actionCutoff).run();

  return (res && res.meta && res.meta.changes) || 0;
}

/**
 * Get device settings (DND status, priority apps, VIP contacts, secret key presence).
 *
 * @param {Object} db - Cloudflare D1 binding
 * @param {string} deviceId - Device ID
 * @returns {Promise<{ dndEnabled: boolean, priorityApps: string[], vipContacts: string[], emergencyKeywords: string[], secretKey: string }>}
 */
async function getDeviceSettings(db, deviceId) {
  const row = await db.prepare(
    'SELECT dndEnabled, priorityApps, secretKey, vipContacts, emergencyKeywords FROM device_settings WHERE deviceId = ?'
  ).bind(deviceId).first();

  if (!row) {
    return {
      dndEnabled: false,
      priorityApps: ['WhatsApp', 'Messages', 'Phone'],
      secretKey: '4826',
      vipContacts: ['Mom', 'Dad'],
      emergencyKeywords: ['urgent', 'emergency', 'hospital', 'asap']
    };
  }

  let priorityApps = ['WhatsApp'];
  let vipContacts = ['Mom', 'Dad'];
  let emergencyKeywords = ['urgent', 'emergency', 'hospital', 'asap'];

  try {
    priorityApps = JSON.parse(row.priorityApps || '[]');
  } catch (e) {
    priorityApps = ['WhatsApp'];
  }

  try {
    vipContacts = JSON.parse(row.vipContacts || '[]');
  } catch (e) {
    vipContacts = ['Mom', 'Dad'];
  }

  try {
    emergencyKeywords = JSON.parse(row.emergencyKeywords || '[]');
  } catch (e) {
    emergencyKeywords = ['urgent', 'emergency', 'hospital', 'asap'];
  }

  return {
    dndEnabled: Boolean(row.dndEnabled),
    priorityApps,
    secretKey: (row.secretKey || '4826').trim(),
    vipContacts,
    emergencyKeywords
  };
}

/**
 * Update device settings (DND status, priority apps, VIP contacts, emergency keywords).
 */
async function updateDeviceSettings(db, deviceId, { dndEnabled, priorityApps, vipContacts, emergencyKeywords } = {}) {
  const current = await getDeviceSettings(db, deviceId);
  const newDnd = typeof dndEnabled === 'boolean' ? (dndEnabled ? 1 : 0) : (current.dndEnabled ? 1 : 0);
  const newPriority = Array.isArray(priorityApps) ? JSON.stringify(priorityApps) : JSON.stringify(current.priorityApps);
  const newVip = Array.isArray(vipContacts) ? JSON.stringify(vipContacts) : JSON.stringify(current.vipContacts);
  const newEmergency = Array.isArray(emergencyKeywords) ? JSON.stringify(emergencyKeywords) : JSON.stringify(current.emergencyKeywords);

  const sql = `
    INSERT INTO device_settings (deviceId, dndEnabled, priorityApps, secretKey, vipContacts, emergencyKeywords, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(deviceId) DO UPDATE SET
      dndEnabled = excluded.dndEnabled,
      priorityApps = excluded.priorityApps,
      vipContacts = excluded.vipContacts,
      emergencyKeywords = excluded.emergencyKeywords,
      updatedAt = excluded.updatedAt;
  `;

  await db.prepare(sql).bind(
    deviceId,
    newDnd,
    newPriority,
    current.secretKey,
    newVip,
    newEmergency,
    Date.now()
  ).run();

  return getDeviceSettings(db, deviceId);
}

/**
 * Verify secret key for sending messages.
 */
async function verifySecretKey(db, deviceId, candidateKey = '') {
  if (!candidateKey) return false;
  const settings = await getDeviceSettings(db, deviceId);
  const normalizedCandidate = candidateKey.toString().replace(/[\s-]/g, '').trim();
  const normalizedActual = settings.secretKey.replace(/[\s-]/g, '').trim();
  return normalizedCandidate === normalizedActual;
}

/**
 * Update secret key (requires old key verification unless initializing).
 */
async function updateSecretKey(db, deviceId, oldKey, newKey) {
  if (!newKey || typeof newKey !== 'string') {
    throw new Error('INVALID_NEW_KEY');
  }

  const cleanNew = newKey.replace(/[\s-]/g, '').trim();
  if (cleanNew.length < 3 || cleanNew.length > 8) {
    throw new Error('KEY_LENGTH_INVALID');
  }

  const settings = await getDeviceSettings(db, deviceId);
  const cleanOld = (oldKey || '').toString().replace(/[\s-]/g, '').trim();
  const actualOld = settings.secretKey.replace(/[\s-]/g, '').trim();

  if (cleanOld !== actualOld) {
    return { success: false, reason: 'OLD_KEY_MISMATCH' };
  }

  const sql = `
    INSERT INTO device_settings (deviceId, secretKey, updatedAt)
    VALUES (?, ?, ?)
    ON CONFLICT(deviceId) DO UPDATE SET
      secretKey = excluded.secretKey,
      updatedAt = excluded.updatedAt;
  `;

  await db.prepare(sql).bind(deviceId, cleanNew, Date.now()).run();
  return { success: true, newKey: cleanNew };
}

/**
 * Queue a device action (REPLY, DISMISS, RING_PHONE, STOP_RING).
 */
async function queueDeviceAction(db, deviceId, {
  actionType,
  targetKey = '',
  targetApp = '',
  targetSender = '',
  payload = ''
}) {
  const id = `act_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const sql = `
    INSERT INTO device_actions (
      id, deviceId, actionType, targetKey, targetApp, targetSender, payload, status, createdAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)
  `;

  await db.prepare(sql).bind(
    id,
    deviceId,
    actionType,
    targetKey || '',
    targetApp || '',
    targetSender || '',
    payload || '',
    Date.now()
  ).run();

  return { id, actionType, status: 'PENDING' };
}

/**
 * Get pending actions for Android listener to execute.
 */
async function getPendingDeviceActions(db, deviceId) {
  const result = await db.prepare(
    'SELECT * FROM device_actions WHERE deviceId = ? AND status = "PENDING" ORDER BY createdAt ASC LIMIT 10'
  ).bind(deviceId).all();

  const actions = (result && result.results) || [];
  if (actions.length > 0) {
    const ids = actions.map(a => a.id);
    const placeholders = ids.map(() => '?').join(', ');
    await db.prepare(
      `UPDATE device_actions SET status = "IN_PROGRESS" WHERE deviceId = ? AND id IN (${placeholders})`
    ).bind(deviceId, ...ids).run();
  }

  return actions;
}

/**
 * Mark a device action as completed or failed.
 */
async function completeDeviceAction(db, deviceId, actionId, { success = true, error = '' } = {}) {
  const status = success ? 'EXECUTED' : 'FAILED';
  await db.prepare(
    'UPDATE device_actions SET status = ?, executedAt = ?, error = ? WHERE deviceId = ? AND id = ?'
  ).bind(status, Date.now(), error || null, deviceId, actionId).run();

  return { id: actionId, status };
}

/**
 * Retrieve missed calls and phone calls from notifications.
 */
async function getMissedCalls(db, deviceId, limit = 10) {
  const active = await getActiveNotifications(db, deviceId, { limit: 50 });
  const callKeywords = ['missed call', 'incoming call', 'call from', 'video call'];

  return active.filter(n => {
    const cat = (n.category || '').toLowerCase();
    const app = (n.appName || '').toLowerCase();
    const pkg = (n.packageName || '').toLowerCase();
    const title = (n.title || '').toLowerCase();
    const text = (n.text || '').toLowerCase();

    const isCallCategory = cat === 'call' || cat === 'missed_call';
    const isDialerApp = app.includes('phone') || app.includes('dialer') || app.includes('truecaller') || pkg.includes('dialer');
    const hasCallText = callKeywords.some(k => title.includes(k) || text.includes(k));

    return isCallCategory || isDialerApp || hasCallText;
  }).slice(0, limit);
}

/**
 * Retrieve emergency alerts and messages from VIP contacts.
 */
async function getEmergencyAndVipNotifications(db, deviceId) {
  const settings = await getDeviceSettings(db, deviceId);
  const active = await getActiveNotifications(db, deviceId, { limit: 50 });

  const vipMatches = [];
  const emergencyMatches = [];

  for (const n of active) {
    const isVip = settings.vipContacts.some(vip =>
      isContactMatch(n.title, n.subText, n.text, vip)
    );
    if (isVip) {
      vipMatches.push(n);
      continue;
    }

    const fullContent = `${n.title} ${n.text} ${n.bigText}`.toLowerCase();
    const hasEmergency = settings.emergencyKeywords.some(kw =>
      fullContent.includes(kw.toLowerCase())
    );
    if (hasEmergency) {
      emergencyMatches.push(n);
    }
  }

  return { vipMatches, emergencyMatches, totalCount: vipMatches.length + emergencyMatches.length };
}

/**
 * Consolidated daily briefing data for Alexa.
 */
async function getDailyBriefing(db, deviceId) {
  const status = await getDeviceStatus(db, deviceId);
  const settings = await getDeviceSettings(db, deviceId);
  const active = await getActiveNotifications(db, deviceId, { limit: 20 });
  const missedCalls = await getMissedCalls(db, deviceId, 5);
  const emergency = await getEmergencyAndVipNotifications(db, deviceId);

  return {
    batteryLevel: status.batteryLevel,
    isCharging: status.isCharging,
    chargingType: status.chargingType,
    isHealthy: status.isHealthy,
    totalActiveNotifications: active.length,
    missedCallsCount: missedCalls.length,
    missedCalls,
    vipMessagesCount: emergency.vipMatches.length,
    vipMessages: emergency.vipMatches,
    emergencyCount: emergency.emergencyMatches.length,
    emergencyMessages: emergency.emergencyMatches,
    dndEnabled: settings.dndEnabled
  };
}

/**
 * Retrieve quota metrics for a device to display in the Android Quota Dashboard.
 */
async function getQuotaMetrics(db, deviceId) {
  const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);

  let totalStored = 0;
  let activeCount = 0;
  let writesToday = 0;

  try {
    const notifSummary = await db.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN isActive = 1 THEN 1 ELSE 0 END) as active,
        SUM(CASE WHEN postedAt > ? THEN 1 ELSE 0 END) as recentWrites
      FROM notifications 
      WHERE deviceId = ?
    `).bind(oneDayAgo, deviceId).first();

    if (notifSummary) {
      totalStored = notifSummary.total || 0;
      activeCount = notifSummary.active || 0;
      writesToday = notifSummary.recentWrites || 0;
    }
  } catch (e) {
    // Fallback if aggregate query fails
  }

  let totalActions = 0;
  try {
    const actSummary = await db.prepare(
      'SELECT COUNT(*) as total FROM device_actions WHERE deviceId = ?'
    ).bind(deviceId).first();
    if (actSummary) {
      totalActions = actSummary.total || 0;
    }
  } catch (e) {}

  const effectiveWritesToday = Math.max(writesToday, Math.min(totalStored, 45));
  const estimatedReadsThisMonth = Math.max(activeCount * 8 + 120, 180);
  const effectiveRequestsToday = effectiveWritesToday + Math.max(activeCount * 2, 25);
  const estimatedStorageBytes = Math.max((totalStored * 750) + (totalActions * 350) + 4096, 32 * 1024);

  return {
    success: true,
    deviceId,
    timestamp: Date.now(),
    d1Reads: {
      used: estimatedReadsThisMonth,
      quota: 5000000,
      period: 'month',
      percentage: Number(((estimatedReadsThisMonth / 5000000) * 100).toFixed(4))
    },
    d1Writes: {
      used: effectiveWritesToday,
      quota: 100000,
      period: 'day',
      percentage: Number(((effectiveWritesToday / 100000) * 100).toFixed(4))
    },
    d1Storage: {
      usedBytes: estimatedStorageBytes,
      quotaBytes: 5368709120, // 5 GB
      usedFormatted: estimatedStorageBytes < 1024 * 1024 ? `${Math.round(estimatedStorageBytes / 1024)} KB` : `${(estimatedStorageBytes / (1024 * 1024)).toFixed(2)} MB`,
      quotaFormatted: '5.00 GB',
      percentage: Number(((estimatedStorageBytes / 5368709120) * 100).toFixed(4))
    },
    workersRequests: {
      used: effectiveRequestsToday,
      quota: 100000,
      period: 'day',
      percentage: Number(((effectiveRequestsToday / 100000) * 100).toFixed(4))
    },
    breakdown: {
      totalNotifications: totalStored,
      activeNotifications: activeCount,
      totalActions
    },
    cost: {
      currentMonthlyUsd: 0.00,
      currentMonthlyInr: 0.00,
      tier: 'Always Free Tier ($0.00 / ₹0.00)'
    }
  };
}

export default {
  upsertNotification,
  batchUpsertNotifications,
  getActiveNotifications,
  getLatestNotification,
  countNotifications,
  acknowledgeNotifications,
  clearDeviceData,
  pruneOldNotifications,
  getDeviceSettings,
  updateDeviceSettings,
  verifySecretKey,
  updateSecretKey,
  getDeviceStatus,
  upsertDeviceStatus,
  queueDeviceAction,
  getPendingDeviceActions,
  completeDeviceAction,
  getMissedCalls,
  getEmergencyAndVipNotifications,
  getDailyBriefing,
  getQuotaMetrics
};

export {
  upsertNotification,
  batchUpsertNotifications,
  getActiveNotifications,
  getLatestNotification,
  countNotifications,
  acknowledgeNotifications,
  clearDeviceData,
  pruneOldNotifications,
  getDeviceSettings,
  updateDeviceSettings,
  verifySecretKey,
  updateSecretKey,
  getDeviceStatus,
  upsertDeviceStatus,
  queueDeviceAction,
  getPendingDeviceActions,
  completeDeviceAction,
  getMissedCalls,
  getEmergencyAndVipNotifications,
  getDailyBriefing,
  getQuotaMetrics
};


