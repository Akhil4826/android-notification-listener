package ee.kytt.androidnotificationlistener.data

import kotlinx.serialization.Serializable

@Serializable
data class NotificationSyncPayload(
    val deviceId: String,
    val timestamp: Long = System.currentTimeMillis(),
    val isFullActiveSync: Boolean = false,
    val notifications: List<Notification>
)
