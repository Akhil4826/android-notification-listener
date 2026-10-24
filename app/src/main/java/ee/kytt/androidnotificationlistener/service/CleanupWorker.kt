package ee.kytt.androidnotificationlistener.service

import android.content.Context
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import ee.kytt.androidnotificationlistener.Constants.DEFAULT_RETENTION_DAYS
import ee.kytt.androidnotificationlistener.Constants.PREFS_NAME
import ee.kytt.androidnotificationlistener.Constants.PREF_RETENTION_DAYS
import ee.kytt.androidnotificationlistener.persistence.NotificationDatabase
import java.time.LocalDate
import java.time.ZoneId

class CleanupWorker(
    appContext: Context,
    workerParams: WorkerParameters
) : CoroutineWorker(appContext, workerParams) {

    override suspend fun doWork(): Result {
        val prefs = applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val retentionDays = prefs.getInt(PREF_RETENTION_DAYS, DEFAULT_RETENTION_DAYS).toLong()

        val cutoff = LocalDate.now()
            .minusDays(retentionDays)
            .atStartOfDay(ZoneId.systemDefault())
            .toInstant()
            .toEpochMilli()

        val db = NotificationDatabase.getDatabase(applicationContext)
        val dao = db.notificationDao()

        dao.deleteOlderThan(cutoff)

        Log.d("CleanupWorker", "Deleted synced notifications older than $retentionDays days (before $cutoff)")

        return Result.success()
    }

}
