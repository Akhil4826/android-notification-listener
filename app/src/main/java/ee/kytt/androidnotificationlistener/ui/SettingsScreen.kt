package ee.kytt.androidnotificationlistener.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.widget.Toast
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import ee.kytt.androidnotificationlistener.Constants.PREFS_NAME
import ee.kytt.androidnotificationlistener.Constants.PREF_CALLBACK_TOKEN
import ee.kytt.androidnotificationlistener.Constants.PREF_CALLBACK_URL
import ee.kytt.androidnotificationlistener.Constants.PREF_DEVICE_ID
import ee.kytt.androidnotificationlistener.Constants.PREF_PACKAGE_PATTERN
import ee.kytt.androidnotificationlistener.Constants.PREF_PRIVACY_MODE
import ee.kytt.androidnotificationlistener.R
import ee.kytt.androidnotificationlistener.persistence.NotificationDatabase
import ee.kytt.androidnotificationlistener.service.NotificationListener
import ee.kytt.androidnotificationlistener.ui.element.ContentGroup
import ee.kytt.androidnotificationlistener.ui.element.SettingSwitch
import ee.kytt.androidnotificationlistener.ui.element.TextField
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

@Composable
fun SettingsScreen(
    context: Context,
    modifier: Modifier = Modifier,
    onBack: (() -> Unit)? = null
) {
    val divModifier = Modifier.padding(vertical = 16.dp)
    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    val deviceId = NotificationListener.getOrCreateDeviceId(context)

    var privacyModeEnabled by remember {
        mutableStateOf(prefs.getBoolean(PREF_PRIVACY_MODE, false))
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.fillMaxWidth()
        ) {
            IconButton(onClick = { onBack?.invoke() }) {
                Icon(
                    imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                    contentDescription = stringResource(R.string.back),
                    tint = MaterialTheme.colorScheme.primary
                )
            }
            Spacer(modifier = Modifier.width(8.dp))
            Text(text = stringResource(R.string.settings), style = MaterialTheme.typography.headlineMedium)
        }

        Spacer(modifier = Modifier.height(32.dp))

        ContentGroup(title = stringResource(R.string.notifications)) {
            EnableNotificationsButton(context)

            HorizontalDivider(modifier = divModifier)

            AutoRevokeStatusButton(context)

            HorizontalDivider(modifier = divModifier)

            SettingSwitch(
                title = stringResource(R.string.privacy_mode_title),
                checked = privacyModeEnabled,
                description = stringResource(R.string.privacy_mode_description),
                onClick = {
                    val newVal = !privacyModeEnabled
                    privacyModeEnabled = newVal
                    prefs.edit().putBoolean(PREF_PRIVACY_MODE, newVal).apply()
                }
            )
        }

        ContentGroup(title = stringResource(R.string.filter)) {
            TextField(
                context = context,
                prefKey = PREF_PACKAGE_PATTERN,
                labelSet = stringResource(R.string.monitor_matching_apps),
                labelNotSet = stringResource(R.string.monitor_all_apps),
                description = stringResource(R.string.monitor_matching_apps_description)
            )
        }

        ContentGroup(title = stringResource(R.string.remote_server)) {
            BackgroundSyncButton(context)

            HorizontalDivider(modifier = divModifier)

            TextField(
                context = context,
                prefKey = PREF_CALLBACK_URL,
                labelSet = stringResource(R.string.callback_url),
                labelNotSet = stringResource(R.string.callback_url_not_set),
                description = stringResource(R.string.callback_url_description)
            )

            HorizontalDivider(modifier = divModifier)

            TextField(
                context = context,
                prefKey = PREF_CALLBACK_TOKEN,
                labelSet = stringResource(R.string.callback_token_set),
                labelNotSet = stringResource(R.string.callback_token_not_set),
                description = stringResource(R.string.callback_token_description)
            )

            HorizontalDivider(modifier = divModifier)

            Text(
                text = "${stringResource(R.string.device_id)}: $deviceId",
                style = MaterialTheme.typography.bodyMedium
            )
            Spacer(modifier = Modifier.height(4.dp))
            Text(
                text = stringResource(R.string.device_id_description),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Spacer(modifier = Modifier.height(8.dp))
            OutlinedButton(
                onClick = {
                    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                    clipboard.setPrimaryClip(ClipData.newPlainText("Device ID", deviceId))
                    Toast.makeText(context, "Device ID copied to clipboard", Toast.LENGTH_SHORT).show()
                },
                modifier = Modifier.fillMaxWidth()
            ) {
                Text("Copy Device ID")
            }
        }

        ContentGroup(title = "Privacy & Data") {
            OutlinedButton(
                onClick = {
                    CoroutineScope(Dispatchers.IO).launch {
                        val db = NotificationDatabase.getDatabase(context)
                        db.notificationDao().deleteAll()
                    }
                    Toast.makeText(context, context.getString(R.string.clear_local_data_success), Toast.LENGTH_SHORT).show()
                },
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error)
            ) {
                Text(stringResource(R.string.clear_local_data))
            }
        }
    }
}
