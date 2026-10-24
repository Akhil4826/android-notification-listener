package ee.kytt.androidnotificationlistener.ui

import android.content.Context
import android.content.Context.MODE_PRIVATE
import android.content.Intent
import android.content.SharedPreferences
import android.provider.Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS
import android.widget.Toast
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import ee.kytt.androidnotificationlistener.Constants.PREFS_NAME
import ee.kytt.androidnotificationlistener.Constants.PREF_ACTIVE_NOTIFICATIONS_COUNT
import ee.kytt.androidnotificationlistener.Constants.PREF_FAIL_COUNT
import ee.kytt.androidnotificationlistener.Constants.PREF_LAST_ACTIVE_SYNC_TIME
import ee.kytt.androidnotificationlistener.Constants.PREF_LAST_SUCCESS_TIME
import ee.kytt.androidnotificationlistener.Constants.PREF_LATEST_ATTEMPT_TIME
import ee.kytt.androidnotificationlistener.Constants.PREF_LATEST_PACKAGE_NAME
import ee.kytt.androidnotificationlistener.Constants.PREF_LATEST_STATUS
import ee.kytt.androidnotificationlistener.Constants.PREF_LATEST_TITLE
import ee.kytt.androidnotificationlistener.R
import ee.kytt.androidnotificationlistener.service.NotificationListener
import ee.kytt.androidnotificationlistener.ui.element.ContentGroup
import ee.kytt.androidnotificationlistener.ui.theme.Green
import ee.kytt.androidnotificationlistener.ui.theme.Red
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

@Composable
fun SyncStatusGroup(
    context: Context
) {
    val prefs = context.getSharedPreferences(PREFS_NAME, MODE_PRIVATE)

    val latestTitle = remember { mutableStateOf(prefs.getString(PREF_LATEST_TITLE, "") ?: "") }
    val latestPackage = remember { mutableStateOf(prefs.getString(PREF_LATEST_PACKAGE_NAME, "-") ?: "-") }
    val latestStatus = remember { mutableStateOf(prefs.getString(PREF_LATEST_STATUS, "-") ?: "-") }
    val latestAttemptTime = remember { mutableLongStateOf(prefs.getLong(PREF_LATEST_ATTEMPT_TIME, 0L)) }
    val lastSuccessTime = remember { mutableLongStateOf(prefs.getLong(PREF_LAST_SUCCESS_TIME, 0L)) }
    val failCount = remember { mutableIntStateOf(prefs.getInt(PREF_FAIL_COUNT, 0)) }
    val activeCount = remember { mutableIntStateOf(prefs.getInt(PREF_ACTIVE_NOTIFICATIONS_COUNT, 0)) }
    val lastActiveSyncTime = remember { mutableLongStateOf(prefs.getLong(PREF_LAST_ACTIVE_SYNC_TIME, 0L)) }
    var isAccessEnabled by remember { mutableStateOf(isNotificationListenerEnabled(context)) }

    val listener = remember {
        SharedPreferences.OnSharedPreferenceChangeListener { _, key ->
            when (key) {
                PREF_LATEST_TITLE -> latestTitle.value = prefs.getString(PREF_LATEST_TITLE, "") ?: ""
                PREF_LATEST_PACKAGE_NAME -> latestPackage.value = prefs.getString(PREF_LATEST_PACKAGE_NAME, "-") ?: "-"
                PREF_LATEST_STATUS -> latestStatus.value = prefs.getString(PREF_LATEST_STATUS, "-") ?: "-"
                PREF_LATEST_ATTEMPT_TIME -> latestAttemptTime.longValue = prefs.getLong(PREF_LATEST_ATTEMPT_TIME, 0L)
                PREF_LAST_SUCCESS_TIME -> lastSuccessTime.longValue = prefs.getLong(PREF_LAST_SUCCESS_TIME, 0L)
                PREF_FAIL_COUNT -> failCount.intValue = prefs.getInt(PREF_FAIL_COUNT, 0)
                PREF_ACTIVE_NOTIFICATIONS_COUNT -> activeCount.intValue = prefs.getInt(PREF_ACTIVE_NOTIFICATIONS_COUNT, 0)
                PREF_LAST_ACTIVE_SYNC_TIME -> lastActiveSyncTime.longValue = prefs.getLong(PREF_LAST_ACTIVE_SYNC_TIME, 0L)
            }
        }
    }

    val labelLastSynced = stringResource(R.string.last_synced)
    val labelUnsyncedEntries = stringResource(R.string.unsynced_entries)
    val labelLatestAttempt = stringResource(R.string.latest_attempt)
    val labelDatetimeFormat = stringResource(R.string.datetime_format)
    val labelDatetimeNever = stringResource(R.string.datetime_never)
    val labelSyncActive = stringResource(R.string.sync_active_notifications)
    val labelSyncing = stringResource(R.string.syncing_active_notifications)

    DisposableEffect(Unit) {
        prefs.registerOnSharedPreferenceChangeListener(listener)
        onDispose {
            prefs.unregisterOnSharedPreferenceChangeListener(listener)
        }
    }

    val isConnected = NotificationListener.isConnected()
    val isSuccess = latestStatus.value.startsWith("Success", ignoreCase = true) || latestStatus.value.startsWith("200") || latestStatus.value.startsWith("201")
    val statusColor = if (isSuccess) Green else Red

    @Composable
    fun InfoText(text: String, isGreen: Boolean? = null) {
        val color = when (isGreen) {
            true -> Green
            false -> Red
            null -> MaterialTheme.colorScheme.onSurface
        }
        Text(
            text = text,
            color = color,
            style = MaterialTheme.typography.bodyMedium
        )
    }

    ContentGroup(title = stringResource(R.string.sync_status)) {
        // Permission Status
        if (isAccessEnabled) {
            InfoText(stringResource(R.string.notification_access_granted), isGreen = true)
        } else {
            InfoText(stringResource(R.string.notification_access_denied), isGreen = false)
            Spacer(modifier = Modifier.height(4.dp))
            OutlinedButton(
                onClick = { context.startActivity(Intent(ACTION_NOTIFICATION_LISTENER_SETTINGS)) },
                modifier = Modifier.fillMaxWidth()
            ) {
                Text(stringResource(R.string.allow_notification_access))
            }
            Spacer(modifier = Modifier.height(8.dp))
        }

        // Listener service status
        if (isConnected) {
            InfoText("Listener Service: Active & Connected", isGreen = true)
        } else {
            InfoText("Listener Service: Inactive / Reconnecting", isGreen = false)
        }

        Spacer(modifier = Modifier.height(4.dp))
        InfoText("${stringResource(R.string.active_notifications_count)}: ${activeCount.intValue}")
        InfoText("${labelUnsyncedEntries}: ${failCount.intValue}", isGreen = if (failCount.intValue == 0) true else false)
        InfoText("${labelLastSynced}: ${formatTimestamp(lastSuccessTime.longValue, labelDatetimeNever, labelDatetimeFormat)}")
        if (latestPackage.value.isNotBlank() && latestPackage.value != "-") {
            InfoText("Last Event: ${latestPackage.value} - ${latestTitle.value}")
        }

        HorizontalDivider(modifier = Modifier.padding(vertical = 12.dp))

        // Manual Active Sync Button
        Button(
            onClick = {
                val listenerService = NotificationListener.instance
                if (listenerService != null) {
                    Toast.makeText(context, labelSyncing, Toast.LENGTH_SHORT).show()
                    listenerService.syncActiveNotifications { success, msg ->
                        Toast.makeText(context, msg, Toast.LENGTH_SHORT).show()
                    }
                } else {
                    Toast.makeText(context, "Listener not running. Tap 'Allow notification access'.", Toast.LENGTH_LONG).show()
                }
            },
            modifier = Modifier.fillMaxWidth()
        ) {
            Text(labelSyncActive)
        }

        Spacer(modifier = Modifier.height(8.dp))

        // Retry pending/unsynced sync button
        SyncNowButton(context, Modifier.fillMaxWidth())
    }
}

fun formatTimestamp(millis: Long, labelNever: String, datetimeFormat: String): String {
    if (millis <= 0) {
        return labelNever
    }
    val formatter = DateTimeFormatter.ofPattern(datetimeFormat).withZone(ZoneId.systemDefault())
    return formatter.format(Instant.ofEpochMilli(millis))
}
