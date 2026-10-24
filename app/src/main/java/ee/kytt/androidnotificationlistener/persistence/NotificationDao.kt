package ee.kytt.androidnotificationlistener.persistence

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import ee.kytt.androidnotificationlistener.data.Notification
import ee.kytt.androidnotificationlistener.data.SyncOverview

@Dao
interface NotificationDao {

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(notification: Notification)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(notifications: List<Notification>)

    @Query("SELECT * FROM notifications WHERE synchronized = 0 ORDER BY postedAt ASC")
    suspend fun getFailed(): List<Notification>

    @Query("SELECT count(*) FROM notifications WHERE synchronized = 0")
    suspend fun countFailed(): Int

    @Query("SELECT * FROM notifications WHERE isActive = 1 ORDER BY postedAt DESC")
    suspend fun getActive(): List<Notification>

    @Query("SELECT count(*) FROM notifications WHERE isActive = 1")
    suspend fun countActive(): Int

    @Query("SELECT * FROM notifications ORDER BY postedAt DESC LIMIT :limit")
    suspend fun getRecent(limit: Int = 100): List<Notification>

    @Query("SELECT count(*) FROM notifications")
    suspend fun countAll(): Int

    @Query("SELECT count(*) FROM notifications WHERE synchronized = 1")
    suspend fun countSynced(): Int

    @Query("UPDATE notifications SET synchronized = 1, syncStatus = 'SYNCED' WHERE id = :id")
    suspend fun markSynced(id: String)

    @Query("UPDATE notifications SET synchronized = 1, syncStatus = 'SYNCED' WHERE id IN (:ids)")
    suspend fun markAllSynced(ids: List<String>)

    @Query("UPDATE notifications SET isActive = 0, updatedAt = :updatedAt, eventType = 'REMOVED' WHERE notificationKey = :key")
    suspend fun markInactiveByKey(key: String, updatedAt: Long)

    @Query("UPDATE notifications SET isActive = 0, updatedAt = :updatedAt WHERE notificationKey NOT IN (:activeKeys) AND isActive = 1")
    suspend fun markAllInactiveExcept(activeKeys: List<String>, updatedAt: Long)

    @Query("DELETE FROM notifications WHERE postedAt < :thresholdTime AND synchronized = 1")
    suspend fun deleteOlderThan(thresholdTime: Long)

    @Query("DELETE FROM notifications WHERE id = :id")
    suspend fun deleteById(id: String)

    @Query("DELETE FROM notifications")
    suspend fun deleteAll()

    @Query("""
        SELECT day,
               SUM(CASE WHEN synchronized = 1 THEN 1 ELSE 0 END) as syncedCount,
               SUM(CASE WHEN synchronized = 0 THEN 1 ELSE 0 END) as unsyncedCount
        FROM notifications
        WHERE day >= :startDay
        GROUP BY day
        ORDER BY day ASC
    """)
    suspend fun getChartData(startDay: Long): List<SyncOverview>

}
