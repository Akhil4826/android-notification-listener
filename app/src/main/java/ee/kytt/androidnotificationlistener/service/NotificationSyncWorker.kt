package ee.kytt.androidnotificationlistener.service

import android.content.Context
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import ee.kytt.androidnotificationlistener.Constants.PREFS_NAME
import ee.kytt.androidnotificationlistener.Constants.PREF_CALLBACK_TOKEN
import ee.kytt.androidnotificationlistener.Constants.PREF_CALLBACK_URL
import ee.kytt.androidnotificationlistener.Constants.PREF_FAIL_COUNT
import ee.kytt.androidnotificationlistener.Constants.PREF_LAST_SUCCESS_TIME
import ee.kytt.androidnotificationlistener.Constants.PREF_LATEST_ATTEMPT_TIME
import ee.kytt.androidnotificationlistener.Constants.PREF_LATEST_PACKAGE_NAME
import ee.kytt.androidnotificationlistener.Constants.PREF_LATEST_STATUS
import ee.kytt.androidnotificationlistener.Constants.PREF_LATEST_SYNC_ERROR
import ee.kytt.androidnotificationlistener.Constants.PREF_LATEST_TITLE
import ee.kytt.androidnotificationlistener.persistence.NotificationDatabase

class NotificationSyncWorker(
    appContext: Context,
    workerParams: WorkerParameters
) : CoroutineWorker(appContext, workerParams) {

    private val maxAttempts = 3
    private val callbackService = ExternalCallback()

    override suspend fun doWork(): Result {
        val prefs = applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val url = prefs.getString(PREF_CALLBACK_URL, null)
        val token = prefs.getString(PREF_CALLBACK_TOKEN, null) ?: ""
        val deviceId = NotificationListener.getOrCreateDeviceId(applicationContext)

        if (url.isNullOrEmpty()) {
            Log.w("NotificationSyncWorker", "No callback URL set")
            return Result.failure()
        }

        Log.d("NotificationSyncWorker", "Starting sync with URL: $url attempt $runAttemptCount")

        val db = NotificationDatabase.getDatabase(applicationContext)
        val dao = db.notificationDao()
        val failedNotifications = dao.getFailed()
        var failedCount = failedNotifications.size

        for (notification in failedNotifications) {
            val response = callbackService.sendSync(url, token, notification, deviceId)

            if (response.success) {
                dao.markSynced(notification.id)
                Log.d("NotificationSyncWorker", "Resent notification: ${notification.id}")
                prefs.edit().apply {
                    putString(PREF_LATEST_TITLE, notification.description())
                    putString(PREF_LATEST_PACKAGE_NAME, notification.appName.ifEmpty { notification.packageName })
                    putString(PREF_LATEST_STATUS, response.status)
                    putString(PREF_LATEST_SYNC_ERROR, response.userMessage)
                    putLong(PREF_LATEST_ATTEMPT_TIME, System.currentTimeMillis())
                    putLong(PREF_LAST_SUCCESS_TIME, System.currentTimeMillis())
                    apply()
                }
                failedCount -= 1
            } else {
                Log.w("NotificationSyncWorker", "Failed to resend notification: ${notification.id}, status: ${response.status}")

                prefs.edit().apply {
                    putInt(PREF_FAIL_COUNT, failedCount)
                    putString(PREF_LATEST_STATUS, response.status)
                    putString(PREF_LATEST_SYNC_ERROR, response.userMessage)
                    putLong(PREF_LATEST_ATTEMPT_TIME, System.currentTimeMillis())
                    apply()
                }

                if (runAttemptCount < maxAttempts) {
                    return Result.retry()
                }

                Log.w("NotificationSyncWorker", "Max retry limit reached ($maxAttempts attempts)")
                return Result.failure()
            }
        }

        prefs.edit().putInt(PREF_FAIL_COUNT, failedCount).apply()
        return Result.success()
    }

}
