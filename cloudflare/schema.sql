-- D1 Database Schema for Personal Phone Notification Reader
-- Designed for Cloudflare D1 (SQLite engine at the edge)

CREATE TABLE IF NOT EXISTS notifications (
    deviceId TEXT NOT NULL,
    notificationKey TEXT NOT NULL,
    packageName TEXT NOT NULL,
    appName TEXT NOT NULL,
    title TEXT,
    text TEXT,
    bigText TEXT,
    subText TEXT,
    category TEXT,
    postedAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL,
    lastSeenAt INTEGER NOT NULL,
    isActive INTEGER NOT NULL DEFAULT 1,
    isReadByAlexa INTEGER NOT NULL DEFAULT 0,
    contentAvailable INTEGER NOT NULL DEFAULT 1,
    eventType TEXT NOT NULL DEFAULT 'POSTED',
    PRIMARY KEY (deviceId, notificationKey)
);

-- Fast lookup for active notifications by device ordered by recency
CREATE INDEX IF NOT EXISTS idx_notifications_device_active_posted 
ON notifications (deviceId, isActive, postedAt DESC);

-- Fast lookup for app-filtered notifications (e.g., WhatsApp, Instagram)
CREATE INDEX IF NOT EXISTS idx_notifications_device_app_posted 
ON notifications (deviceId, isActive, appName, postedAt DESC);

-- Index for TTL / retention pruning
CREATE INDEX IF NOT EXISTS idx_notifications_postedAt
ON notifications (postedAt);

-- Settings table for DND, VIP Contacts, and PIN-Protected Message Sending
CREATE TABLE IF NOT EXISTS device_settings (
    deviceId TEXT PRIMARY KEY,
    dndEnabled INTEGER NOT NULL DEFAULT 0,
    priorityApps TEXT NOT NULL DEFAULT '["WhatsApp"]',
    secretKey TEXT NOT NULL DEFAULT '4826',
    vipContacts TEXT NOT NULL DEFAULT '["Mom", "Dad"]',
    emergencyKeywords TEXT NOT NULL DEFAULT '["urgent", "emergency", "hospital", "asap"]',
    updatedAt INTEGER NOT NULL
);

-- Device Status table for battery level, charging state, and ringer mode
CREATE TABLE IF NOT EXISTS device_status (
    deviceId TEXT PRIMARY KEY,
    batteryLevel INTEGER DEFAULT 100,
    isCharging INTEGER DEFAULT 0,
    chargingType TEXT DEFAULT 'NONE',
    isPowerSave INTEGER DEFAULT 0,
    ringerMode TEXT DEFAULT 'NORMAL',
    isPhoneRinging INTEGER DEFAULT 0,
    lastSeenAt INTEGER NOT NULL
);

-- Device Actions Queue (Direct Reply, Dismiss from Phone, Ring Phone)
CREATE TABLE IF NOT EXISTS device_actions (
    id TEXT PRIMARY KEY,
    deviceId TEXT NOT NULL,
    actionType TEXT NOT NULL, -- 'REPLY', 'DISMISS', 'RING_PHONE', 'STOP_RING'
    targetKey TEXT,
    targetApp TEXT,
    targetSender TEXT,
    payload TEXT,
    status TEXT NOT NULL DEFAULT 'PENDING', -- 'PENDING', 'EXECUTED', 'FAILED', 'EXPIRED'
    createdAt INTEGER NOT NULL,
    executedAt INTEGER,
    error TEXT
);

CREATE INDEX IF NOT EXISTS idx_device_actions_pending
ON device_actions (deviceId, status, createdAt ASC);


