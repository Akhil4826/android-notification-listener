/**
 * In-memory Mock of Cloudflare D1 Database Binding.
 * Implements prepared statement parsing, parameter binding, and batch operations.
 */

class MockD1 {
  constructor() {
    this.store = new Map(); // Key: `${deviceId}|${notificationKey}` -> row object
    this.settings = new Map(); // Key: deviceId -> { dndEnabled, priorityApps, secretKey, vipContacts, emergencyKeywords }
    this.deviceStatus = new Map(); // Key: deviceId -> status object
    this.actions = new Map(); // Key: id -> action object
  }

  clear() {
    this.store.clear();
    this.settings.clear();
    this.deviceStatus.clear();
    this.actions.clear();
  }

  prepare(sql) {
    return new MockPreparedStatement(this, sql);
  }

  async batch(statements) {
    const results = [];
    for (const stmt of statements) {
      results.push(await stmt.run());
    }
    return results;
  }
}

class MockPreparedStatement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql.trim();
    this.params = [];
  }

  bind(...params) {
    this.params = params;
    return this;
  }

  async run() {
    const sql = this.sql.replace(/\s+/g, ' ');
    const params = this.params;

    // Handle INSERT INTO notifications ... ON CONFLICT
    if (sql.includes('INSERT INTO notifications')) {
      const [
        deviceId, notificationKey, packageName, appName, title, text, bigText, subText, category,
        postedAt, updatedAt, lastSeenAt, isActive, isReadByAlexa, contentAvailable, eventType
      ] = params;

      const key = `${deviceId}|${notificationKey}`;
      const record = {
        deviceId,
        notificationKey,
        packageName,
        appName,
        title,
        text,
        bigText,
        subText,
        category,
        postedAt: Number(postedAt),
        updatedAt: Number(updatedAt),
        lastSeenAt: Number(lastSeenAt),
        isActive: Number(isActive),
        isReadByAlexa: Number(isReadByAlexa),
        contentAvailable: Number(contentAvailable),
        eventType
      };

      this.db.store.set(key, record);
      return { success: true, meta: { changes: 1 } };
    }

    // Handle UPDATE notifications SET isActive = 0 WHERE deviceId = ?
    if (sql.includes('UPDATE notifications SET isActive = 0 WHERE deviceId = ?')) {
      const [deviceId] = params;
      let changes = 0;
      for (const [key, record] of this.db.store.entries()) {
        if (record.deviceId === deviceId) {
          record.isActive = 0;
          changes++;
        }
      }
      return { success: true, meta: { changes } };
    }

    // Handle UPDATE notifications SET isReadByAlexa = 1 WHERE deviceId = ? AND notificationKey = ?
    if (sql.includes('SET isReadByAlexa = 1')) {
      const [deviceId, notificationKey] = params;
      const key = `${deviceId}|${notificationKey}`;
      const record = this.db.store.get(key);
      if (record) {
        record.isReadByAlexa = 1;
        return { success: true, meta: { changes: 1 } };
      }
      return { success: true, meta: { changes: 0 } };
    }

    // Handle DELETE FROM notifications WHERE deviceId = ? AND notificationKey = ?
    if (sql.includes('WHERE deviceId = ? AND notificationKey = ?')) {
      const [deviceId, notificationKey] = params;
      const key = `${deviceId}|${notificationKey}`;
      const deleted = this.db.store.delete(key);
      return { success: true, meta: { changes: deleted ? 1 : 0 } };
    }

    // Handle DELETE FROM notifications WHERE deviceId = ?
    if (sql.includes('DELETE FROM notifications WHERE deviceId = ?')) {
      const [deviceId] = params;
      let changes = 0;
      for (const [key, record] of Array.from(this.db.store.entries())) {
        if (record.deviceId === deviceId) {
          this.db.store.delete(key);
          changes++;
        }
      }
      return { success: true, meta: { changes } };
    }

    // Handle INSERT INTO device_settings ... ON CONFLICT
    if (sql.includes('INSERT INTO device_settings')) {
      if (sql.includes('secretKey, updatedAt')) {
        // updateSecretKey query: [deviceId, cleanNew, Date.now()]
        const [deviceId, secretKey] = params;
        const existing = this.db.settings.get(deviceId) || {
          deviceId,
          dndEnabled: 0,
          priorityApps: '["WhatsApp"]',
          vipContacts: '["Mom", "Dad"]',
          emergencyKeywords: '["urgent", "emergency", "hospital", "asap"]'
        };
        existing.secretKey = String(secretKey);
        this.db.settings.set(deviceId, existing);
        return { success: true, meta: { changes: 1 } };
      }

      const [deviceId, dndEnabled, priorityApps, secretKey, vipContacts, emergencyKeywords] = params;
      this.db.settings.set(deviceId, {
        deviceId,
        dndEnabled: Number(dndEnabled),
        priorityApps: String(priorityApps || '["WhatsApp"]'),
        secretKey: String(secretKey || '4826'),
        vipContacts: String(vipContacts || '["Mom", "Dad"]'),
        emergencyKeywords: String(emergencyKeywords || '["urgent", "emergency"]')
      });
      return { success: true, meta: { changes: 1 } };
    }

    // Handle INSERT INTO device_status
    if (sql.includes('INSERT INTO device_status')) {
      const [deviceId, batteryLevel, isCharging, chargingType, isPowerSave, ringerMode, isPhoneRinging, lastSeenAt] = params;
      this.db.deviceStatus.set(deviceId, {
        deviceId,
        batteryLevel: Number(batteryLevel),
        isCharging: Number(isCharging),
        chargingType: String(chargingType || 'NONE'),
        isPowerSave: Number(isPowerSave),
        ringerMode: String(ringerMode || 'NORMAL'),
        isPhoneRinging: Number(isPhoneRinging),
        lastSeenAt: Number(lastSeenAt)
      });
      return { success: true, meta: { changes: 1 } };
    }

    // Handle INSERT INTO device_actions
    if (sql.includes('INSERT INTO device_actions')) {
      const [id, deviceId, actionType, targetKey, targetApp, targetSender, payload, createdAt] = params;
      this.db.actions.set(id, {
        id,
        deviceId,
        actionType,
        targetKey,
        targetApp,
        targetSender,
        payload,
        status: 'PENDING',
        createdAt: Number(createdAt)
      });
      return { success: true, meta: { changes: 1 } };
    }

    // Handle UPDATE device_actions SET status = ?
    if (sql.includes('UPDATE device_actions SET status = ?')) {
      const [status, executedAt, error, deviceId, actionId] = params;
      const act = this.db.actions.get(actionId);
      if (act) {
        act.status = status;
        act.executedAt = executedAt;
        act.error = error;
        return { success: true, meta: { changes: 1 } };
      }
      return { success: true, meta: { changes: 0 } };
    }

    // Handle DELETE FROM notifications WHERE postedAt < ? OR ...
    if (sql.includes('DELETE FROM notifications WHERE postedAt < ?')) {
      const [cutoffTime] = params;
      let changes = 0;
      for (const [key, record] of Array.from(this.db.store.entries())) {
        if (record.postedAt < cutoffTime) {
          this.db.store.delete(key);
          changes++;
        }
      }
      return { success: true, meta: { changes } };
    }

    return { success: true, meta: { changes: 0 } };
  }

  async all() {
    const sql = this.sql.replace(/\s+/g, ' ');
    const params = this.params;

    // Handle pending device_actions
    if (sql.includes('FROM device_actions WHERE deviceId = ? AND status = "PENDING"')) {
      const [deviceId] = params;
      const results = [];
      for (const act of this.db.actions.values()) {
        if (act.deviceId === deviceId && act.status === 'PENDING') {
          results.push({ ...act });
        }
      }
      return { results };
    }

    // Handle GROUP BY appName query in countNotifications
    if (sql.includes('GROUP BY appName')) {
      const [deviceId] = params;
      const counts = {};
      for (const record of this.db.store.values()) {
        if (record.deviceId === deviceId && record.isActive === 1) {
          counts[record.appName] = (counts[record.appName] || 0) + 1;
        }
      }
      const results = Object.entries(counts).map(([appName, appCount]) => ({ appName, appCount }));
      return { results };
    }

    // Handle SELECT * FROM notifications WHERE deviceId = ? AND isActive = 1 ...
    if (sql.includes('SELECT * FROM notifications WHERE deviceId = ? AND isActive = 1')) {
      const deviceId = params[0];
      let appFilter = null;
      let limit = 25;

      if (params.length === 4) {
        appFilter = String(params[1]).replace(/%/g, '').toLowerCase();
        limit = Number(params[3]);
      } else if (params.length === 2) {
        limit = Number(params[1]);
      }

      const rows = [];
      for (const record of this.db.store.values()) {
        if (record.deviceId !== deviceId || record.isActive !== 1) continue;

        if (appFilter) {
          const app = (record.appName || '').toLowerCase();
          const pkg = (record.packageName || '').toLowerCase();
          if (!app.includes(appFilter) && !pkg.includes(appFilter)) {
            continue;
          }
        }
        rows.push({ ...record });
      }

      // ORDER BY postedAt DESC
      rows.sort((a, b) => (b.postedAt || 0) - (a.postedAt || 0));

      return { results: rows.slice(0, limit) };
    }

    return { results: [] };
  }

  async first() {
    const sql = this.sql;
    const params = this.params;

    // Handle SELECT MAX(updatedAt)... for phone status
    if (sql.includes('SELECT MAX(updatedAt)')) {
      const [deviceId] = params;
      let lastUpdatedAt = 0;
      let lastPostedAt = 0;
      let totalStored = 0;
      for (const record of this.db.store.values()) {
        if (record.deviceId === deviceId) {
          totalStored++;
          if ((record.updatedAt || 0) > lastUpdatedAt) lastUpdatedAt = record.updatedAt;
          if ((record.postedAt || 0) > lastPostedAt) lastPostedAt = record.postedAt;
        }
      }
      return { lastUpdatedAt, lastPostedAt, totalStored };
    }

    // Handle SELECT batteryLevel, isCharging... FROM device_status
    if (sql.includes('FROM device_status WHERE deviceId = ?')) {
      const [deviceId] = params;
      return this.db.deviceStatus.get(deviceId) || null;
    }

    // Handle SELECT COUNT(*) as activeCount FROM notifications WHERE deviceId = ? AND isActive = 1
    if (sql.includes('SELECT COUNT(*) as activeCount')) {
      const [deviceId] = params;
      let activeCount = 0;
      for (const record of this.db.store.values()) {
        if (record.deviceId === deviceId && record.isActive === 1) {
          activeCount++;
        }
      }
      return { activeCount };
    }

    // Handle SELECT COUNT(*) as total FROM notifications WHERE deviceId = ? AND isActive = 1
    if (sql.includes('SELECT COUNT(*) as total')) {
      const [deviceId] = params;
      let total = 0;
      for (const record of this.db.store.values()) {
        if (record.deviceId === deviceId && record.isActive === 1) {
          total++;
        }
      }
      return { total };
    }

    // Handle SELECT dndEnabled, priorityApps FROM device_settings WHERE deviceId = ?
    if (sql.includes('FROM device_settings WHERE deviceId = ?')) {
      const [deviceId] = params;
      const setting = this.db.settings.get(deviceId);
      return setting || null;
    }

    const { results } = await this.all();
    return results.length > 0 ? results[0] : null;
  }
}

export {
  MockD1
};
export default {
  MockD1
};

