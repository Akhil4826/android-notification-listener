package ee.kytt.androidnotificationlistener

object Constants {
    const val PREFS_NAME = "app_prefs"
    const val PREF_CALLBACK_URL = "callback_url"
    const val PREF_PACKAGE_PATTERN = "package_pattern"
    const val PREF_CALLBACK_TOKEN = "callback_token"
    const val PREF_LATEST_TITLE = "latestTitle"
    const val PREF_LATEST_PACKAGE_NAME = "latestPackageName"
    const val PREF_LATEST_STATUS = "latestStatus"
    const val PREF_LATEST_ATTEMPT_TIME = "latestAttemptTime"
    const val PREF_LAST_SUCCESS_TIME = "lastSuccessTime"
    const val PREF_LATEST_SYNC_ERROR = "latest_error"
    const val PREF_FAIL_COUNT = "failCount"
    const val PREF_SYNC_ENABLED = "sync_enabled"
    const val PREF_DEVICE_ID = "device_id"
    const val PREF_ACTIVE_NOTIFICATIONS_COUNT = "active_notifications_count"
    const val PREF_LAST_ACTIVE_SYNC_TIME = "last_active_sync_time"
    const val PREF_RETENTION_DAYS = "retention_days"
    const val PREF_PRIVACY_MODE = "privacy_mode"
    const val PREF_SECRET_PIN = "secret_pin"
    const val DEFAULT_SECRET_PIN = "4826"
    const val DEFAULT_RETENTION_DAYS = 7
    const val BACKGROUND_WORK_NAME = "notification_sync"
    const val MANUAL_WORK_NAME = "manual_sync"
    const val CLEANUP_WORK_NAME = "daily_notification_cleanup"
    const val SETTINGS_URI = "enabled_notification_listeners"
    const val ACTION_SYNC_ACTIVE_NOTIFICATIONS = "ee.kytt.androidnotificationlistener.SYNC_ACTIVE"
}
