package ee.kytt.androidnotificationlistener

import ee.kytt.androidnotificationlistener.data.Notification
import ee.kytt.androidnotificationlistener.data.NotificationSyncPayload
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class NotificationModelTest {

    private val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
    }

    @Test
    fun testFallbackAppNames() {
        assertEquals("WhatsApp", Notification.resolveFallbackAppName("com.whatsapp"))
        assertEquals("Instagram", Notification.resolveFallbackAppName("com.instagram.android"))
        assertEquals("Gmail", Notification.resolveFallbackAppName("com.google.android.gm"))
        assertEquals("Slack", Notification.resolveFallbackAppName("com.Slack"))
        assertEquals("Telegram", Notification.resolveFallbackAppName("org.telegram.messenger"))
        assertEquals("X", Notification.resolveFallbackAppName("com.twitter.android"))
        assertEquals("Messenger", Notification.resolveFallbackAppName("com.facebook.orca"))
        assertEquals("Facebook", Notification.resolveFallbackAppName("com.facebook.katana"))
    }

    @Test
    fun testHashIdDeterminism() {
        val hash1 = Notification.hashId("device-123|key-456|1700000000|POSTED")
        val hash2 = Notification.hashId("device-123|key-456|1700000000|POSTED")
        val hash3 = Notification.hashId("device-123|key-456|1700000000|REMOVED")

        assertEquals(hash1, hash2)
        assertNotEquals(hash1, hash3)
        assertEquals(64, hash1.length) // SHA-256 hex string
    }

    @Test
    fun testNotificationSerialization() {
        val notification = Notification(
            id = "notif-1",
            notificationKey = "0|com.whatsapp|100|tag|1001",
            deviceId = "dev-abc",
            packageName = "com.whatsapp",
            appName = "WhatsApp",
            title = "John Doe",
            text = "Are we still meeting at six?",
            subText = "",
            bigText = "Are we still meeting at six?",
            category = "msg",
            postedAt = 1700000000000L,
            updatedAt = 1700000000000L,
            lastSeenAt = 1700000000000L,
            isActive = true,
            isReadByAlexa = false,
            contentAvailable = true,
            eventType = "POSTED",
            syncStatus = "PENDING"
        )

        val serialized = json.encodeToString(Notification.serializer(), notification)
        assertTrue(serialized.contains("\"appName\":\"WhatsApp\""))
        assertTrue(serialized.contains("\"title\":\"John Doe\""))
        assertTrue(serialized.contains("\"isActive\":true"))
        assertTrue(serialized.contains("\"notificationKey\":\"0|com.whatsapp|100|tag|1001\""))

        val deserialized = json.decodeFromString(Notification.serializer(), serialized)
        assertEquals(notification.id, deserialized.id)
        assertEquals(notification.appName, deserialized.appName)
        assertEquals(notification.text, deserialized.text)
        assertEquals(notification.isActive, deserialized.isActive)
    }

    @Test
    fun testNotificationSyncPayloadSerialization() {
        val notif1 = Notification(
            id = "notif-1",
            notificationKey = "0|com.instagram.android|200|tag|1002",
            deviceId = "dev-abc",
            packageName = "com.instagram.android",
            appName = "Instagram",
            title = "Instagram User",
            text = "Someone shared a reel with you",
            postedAt = 1700000005000L,
            isActive = true
        )

        val payload = NotificationSyncPayload(
            deviceId = "dev-abc",
            timestamp = 1700000010000L,
            isFullActiveSync = true,
            notifications = listOf(notif1)
        )

        val serialized = json.encodeToString(NotificationSyncPayload.serializer(), payload)
        assertTrue(serialized.contains("\"isFullActiveSync\":true"))
        assertTrue(serialized.contains("\"deviceId\":\"dev-abc\""))

        val deserialized = json.decodeFromString(NotificationSyncPayload.serializer(), serialized)
        assertEquals(1, deserialized.notifications.size)
        assertEquals("Instagram", deserialized.notifications[0].appName)
    }

    @Test
    fun testDescriptionFallback() {
        val notifWithTitle = Notification(
            id = "1",
            notificationKey = "k1",
            packageName = "com.test",
            title = "My Title",
            text = "",
            postedAt = 100L
        )
        assertEquals("My Title", notifWithTitle.description())

        val notifWithOnlyText = Notification(
            id = "2",
            notificationKey = "k2",
            packageName = "com.test",
            title = "",
            text = "My Text",
            postedAt = 100L
        )
        assertEquals("My Text", notifWithOnlyText.description())
    }

    @Test
    fun testContentAvailableFlag() {
        val available = Notification(
            id = "1",
            notificationKey = "k1",
            packageName = "com.whatsapp",
            title = "Alice",
            text = "Hello",
            contentAvailable = true,
            postedAt = 100L
        )
        assertTrue(available.contentAvailable)

        val hidden = Notification(
            id = "2",
            notificationKey = "k2",
            packageName = "com.whatsapp",
            title = "",
            text = "",
            contentAvailable = false,
            postedAt = 100L
        )
        assertFalse(hidden.contentAvailable)
    }
}
