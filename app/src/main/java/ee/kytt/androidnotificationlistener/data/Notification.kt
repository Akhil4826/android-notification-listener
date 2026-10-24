package ee.kytt.androidnotificationlistener.data

import android.app.Notification.EXTRA_BIG_TEXT
import android.app.Notification.EXTRA_MESSAGES
import android.app.Notification.EXTRA_PICTURE
import android.app.Notification.EXTRA_PICTURE_ICON
import android.app.Notification.EXTRA_SUB_TEXT
import android.app.Notification.EXTRA_SUMMARY_TEXT
import android.app.Notification.EXTRA_TEMPLATE
import android.app.Notification.EXTRA_TEXT
import android.app.Notification.EXTRA_TEXT_LINES
import android.app.Notification.EXTRA_TITLE
import android.content.Context
import android.os.Bundle
import android.service.notification.StatusBarNotification
import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.PrimaryKey
import kotlinx.serialization.Serializable
import kotlinx.serialization.Transient
import java.security.MessageDigest
import java.time.Instant
import java.time.ZoneId

@OptIn(kotlinx.serialization.InternalSerializationApi::class)
@Serializable
@Entity(tableName = "notifications")
data class Notification(
    @PrimaryKey
    val id: String,
    val notificationKey: String,
    val deviceId: String = "",
    val packageName: String,
    val appName: String = "",
    val title: String = "",
    val text: String = "",
    val subText: String = "",
    val bigText: String = "",
    val category: String = "",
    val postedAt: Long = 0L,
    var updatedAt: Long = postedAt,
    var lastSeenAt: Long = postedAt,
    val isActive: Boolean = true,
    val isReadByAlexa: Boolean = false,
    val contentAvailable: Boolean = true,
    val eventType: String = "POSTED", // POSTED, UPDATED, REMOVED, SYNC_ACTIVE
    val syncStatus: String = "PENDING",

    // Backward compatibility fields for existing code/queries
    val key: String = notificationKey,
    val time: Long = postedAt,

    @Transient
    @ColumnInfo(name = "day")
    var day: Long = 0L,

    @Transient
    @ColumnInfo(name = "synchronized")
    val synchronized: Boolean = false
) {
    companion object {
        fun hashId(input: String): String {
            val bytes = MessageDigest.getInstance("SHA-256").digest(input.toByteArray())
            return bytes.joinToString("") { "%02x".format(it) }
        }

        fun resolveFallbackAppName(pkg: String): String {
            return when {
                pkg.contains("whatsapp", ignoreCase = true) -> "WhatsApp"
                pkg.contains("instagram", ignoreCase = true) -> "Instagram"
                pkg.contains("android.gm", ignoreCase = true) || pkg.contains("gmail", ignoreCase = true) -> "Gmail"
                pkg.contains("messaging", ignoreCase = true) || pkg.contains("mms", ignoreCase = true) -> "Messages"
                pkg.contains("slack", ignoreCase = true) -> "Slack"
                pkg.contains("telegram", ignoreCase = true) -> "Telegram"
                pkg.contains("twitter", ignoreCase = true) || pkg.contains("android.twitter", ignoreCase = true) -> "X"
                pkg.contains("facebook.orca", ignoreCase = true) -> "Messenger"
                pkg.contains("facebook", ignoreCase = true) -> "Facebook"
                pkg.contains("teams", ignoreCase = true) -> "Teams"
                pkg.contains("outlook", ignoreCase = true) -> "Outlook"
                else -> pkg.substringAfterLast('.').replaceFirstChar { it.uppercase() }
            }
        }

        fun describeMimeType(mimeType: String?): String {
            if (mimeType.isNullOrBlank()) return "📷 [Photo / Poster Attached]"
            val lower = mimeType.lowercase()
            return when {
                lower.startsWith("image/") -> "📷 [Photo / Poster Attached]"
                lower.startsWith("video/") -> "🎥 [Video Attached]"
                lower.startsWith("audio/") -> "🎵 [Voice Note / Audio Attached]"
                lower.contains("pdf") || lower.startsWith("application/pdf") -> "📄 [PDF Document Attached]"
                lower.startsWith("application/") -> "📄 [Document / File Attached]"
                else -> "📎 [Attachment]"
            }
        }

        fun isIgnorableEmptySummary(sbn: StatusBarNotification): Boolean {
            val isGroupSummary = (sbn.notification.flags and android.app.Notification.FLAG_GROUP_SUMMARY) != 0
            val title = extractTitle(sbn)
            val text = extractText(sbn)
            val bigText = extractBigText(sbn)

            // If it's an Android system group summary header with no body text, it's just a bundling container
            if (isGroupSummary && text.isBlank() && bigText.isBlank()) {
                return true
            }

            // Check if there is any visual, attachment, or text content
            val extras = sbn.notification.extras
            val hasPicture = extras?.containsKey(EXTRA_PICTURE) == true ||
                             extras?.containsKey("android.picture") == true ||
                             extras?.containsKey(EXTRA_PICTURE_ICON) == true
            if (title.isBlank() && text.isBlank() && bigText.isBlank() && !hasPicture) {
                return true
            }

            return false
        }
    }

    constructor(
        sbn: StatusBarNotification,
        context: Context? = null,
        deviceId: String = "",
        eventType: String = "POSTED",
        isActive: Boolean = true
    ) : this(
        id = hashId("${deviceId}|${sbn.key}|${sbn.postTime}|${eventType}"),
        notificationKey = sbn.key,
        deviceId = deviceId,
        packageName = sbn.packageName,
        appName = context?.let { ctx ->
            try {
                val pm = ctx.packageManager
                val ai = pm.getApplicationInfo(sbn.packageName, 0)
                pm.getApplicationLabel(ai).toString()
            } catch (e: Exception) {
                resolveFallbackAppName(sbn.packageName)
            }
        } ?: resolveFallbackAppName(sbn.packageName),
        title = extractTitle(sbn),
        text = extractText(sbn),
        subText = sbn.notification.extras.getCharSequence(EXTRA_SUB_TEXT, "")?.toString() ?: "",
        bigText = extractBigText(sbn),
        category = sbn.notification.category ?: "",
        postedAt = sbn.postTime,
        updatedAt = System.currentTimeMillis(),
        lastSeenAt = System.currentTimeMillis(),
        isActive = isActive,
        isReadByAlexa = false,
        contentAvailable = checkContentAvailable(sbn),
        eventType = eventType,
        syncStatus = "PENDING",
        key = sbn.key,
        time = sbn.postTime,
        day = Instant.ofEpochMilli(sbn.postTime)
            .atZone(ZoneId.systemDefault())
            .toLocalDate()
            .toEpochDay(),
        synchronized = false
    )

    constructor(sbn: StatusBarNotification) : this(
        sbn = sbn,
        context = null,
        deviceId = "",
        eventType = "POSTED",
        isActive = true
    )

    fun description(): String {
        return listOf(title, text, subText, bigText).firstOrNull { it.isNotBlank() } ?: ""
    }
}

private fun extractTitle(sbn: StatusBarNotification): String {
    val extras = sbn.notification.extras
    return extras.getCharSequence(EXTRA_TITLE)?.toString()?.trim()
        ?: extras.getCharSequence("android.title.big")?.toString()?.trim()
        ?: ""
}

private fun extractText(sbn: StatusBarNotification): String {
    val extras = sbn.notification.extras
    var directText = extras.getCharSequence(EXTRA_TEXT)?.toString()?.trim() ?: ""

    // If directText is empty, check messaging style
    if (directText.isEmpty()) {
        val messages = extras.getParcelableArray(EXTRA_MESSAGES)
        if (!messages.isNullOrEmpty()) {
            val last = messages.lastOrNull()
            if (last is Bundle) {
                val msg = last.getCharSequence("text")?.toString()?.trim()
                if (!msg.isNullOrEmpty()) {
                    directText = msg
                } else {
                    val mimeType = last.getString("type")
                    if (!mimeType.isNullOrEmpty()) {
                        directText = Notification.describeMimeType(mimeType)
                    }
                }
            }
        }
    }

    // If still empty, check if BigPictureStyle or picture attachment is present
    if (directText.isEmpty()) {
        val hasPicture = extras.containsKey(EXTRA_PICTURE) ||
                         extras.containsKey("android.picture") ||
                         extras.containsKey(EXTRA_PICTURE_ICON)
        val template = extras.getString(EXTRA_TEMPLATE) ?: ""
        if (hasPicture || template.contains("BigPictureStyle", ignoreCase = true)) {
            val summary = extras.getCharSequence(EXTRA_SUMMARY_TEXT)?.toString()?.trim()
            directText = if (!summary.isNullOrEmpty()) {
                "$summary 📷 [Photo / Poster Attached]"
            } else {
                "📷 [Photo / Poster Attached]"
            }
        }
    }

    return directText
}

private fun extractBigText(sbn: StatusBarNotification): String {
    val extras = sbn.notification.extras
    var bigText = extras.getCharSequence(EXTRA_BIG_TEXT)?.toString()?.trim() ?: ""

    val textLines = extras.getCharSequenceArray(EXTRA_TEXT_LINES)
    if (!textLines.isNullOrEmpty()) {
        val joined = textLines.filterNotNull().map { it.toString().trim() }.filter { it.isNotEmpty() }.joinToString(". ")
        if (joined.isNotEmpty()) {
            bigText = if (bigText.isNotEmpty()) "$bigText. $joined" else joined
        }
    }

    val messages = extras.getParcelableArray(EXTRA_MESSAGES)
    if (!messages.isNullOrEmpty()) {
        val extracted = mutableListOf<String>()
        for (msgObj in messages) {
            if (msgObj is Bundle) {
                var msgText = msgObj.getCharSequence("text")?.toString()?.trim()
                val mimeType = msgObj.getString("type")
                if (msgText.isNullOrEmpty() && !mimeType.isNullOrEmpty()) {
                    msgText = Notification.describeMimeType(mimeType)
                } else if (!msgText.isNullOrEmpty() && !mimeType.isNullOrEmpty()) {
                    val mediaTag = Notification.describeMimeType(mimeType)
                    msgText = "$msgText $mediaTag"
                }

                val sender = msgObj.getCharSequence("sender")?.toString()?.trim()
                if (!msgText.isNullOrEmpty()) {
                    if (!sender.isNullOrEmpty()) extracted.add("$sender: $msgText") else extracted.add(msgText)
                }
            }
        }
        if (extracted.isNotEmpty()) {
            val joined = extracted.joinToString(". ")
            bigText = if (bigText.isNotEmpty()) "$bigText. $joined" else joined
        }
    }

    // If bigText is empty but BigPictureStyle or picture attachment is present
    if (bigText.isEmpty()) {
        val hasPicture = extras.containsKey(EXTRA_PICTURE) ||
                         extras.containsKey("android.picture") ||
                         extras.containsKey(EXTRA_PICTURE_ICON)
        val template = extras.getString(EXTRA_TEMPLATE) ?: ""
        if (hasPicture || template.contains("BigPictureStyle", ignoreCase = true)) {
            val summary = extras.getCharSequence(EXTRA_SUMMARY_TEXT)?.toString()?.trim()
            bigText = if (!summary.isNullOrEmpty()) {
                "$summary 📷 [Photo / Poster Attached]"
            } else {
                "📷 [Photo / Poster Attached]"
            }
        }
    }

    return bigText
}

private fun checkContentAvailable(sbn: StatusBarNotification): Boolean {
    val title = extractTitle(sbn)
    val text = extractText(sbn)
    val bigText = extractBigText(sbn)
    val extras = sbn.notification.extras
    val hasPicture = extras?.containsKey(EXTRA_PICTURE) == true ||
                     extras?.containsKey("android.picture") == true ||
                     extras?.containsKey(EXTRA_PICTURE_ICON) == true
    return title.isNotBlank() || text.isNotBlank() || bigText.isNotBlank() || hasPicture
}
