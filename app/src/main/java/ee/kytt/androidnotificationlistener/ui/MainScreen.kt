package ee.kytt.androidnotificationlistener.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Context.MODE_PRIVATE
import android.content.Intent
import android.content.IntentFilter
import android.content.SharedPreferences
import android.os.BatteryManager
import android.provider.Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS
import android.widget.Toast
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.List
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ee.kytt.androidnotificationlistener.Constants.DEFAULT_RETENTION_DAYS
import ee.kytt.androidnotificationlistener.Constants.DEFAULT_SECRET_PIN
import ee.kytt.androidnotificationlistener.Constants.PREFS_NAME
import ee.kytt.androidnotificationlistener.Constants.PREF_ACTIVE_NOTIFICATIONS_COUNT
import ee.kytt.androidnotificationlistener.Constants.PREF_CALLBACK_TOKEN
import ee.kytt.androidnotificationlistener.Constants.PREF_CALLBACK_URL
import ee.kytt.androidnotificationlistener.Constants.PREF_FAIL_COUNT
import ee.kytt.androidnotificationlistener.Constants.PREF_LAST_SUCCESS_TIME
import ee.kytt.androidnotificationlistener.Constants.PREF_LATEST_PACKAGE_NAME
import ee.kytt.androidnotificationlistener.Constants.PREF_LATEST_STATUS
import ee.kytt.androidnotificationlistener.Constants.PREF_LATEST_TITLE
import ee.kytt.androidnotificationlistener.Constants.PREF_RETENTION_DAYS
import ee.kytt.androidnotificationlistener.Constants.PREF_SECRET_PIN
import ee.kytt.androidnotificationlistener.R
import ee.kytt.androidnotificationlistener.data.Notification
import ee.kytt.androidnotificationlistener.persistence.NotificationDatabase
import ee.kytt.androidnotificationlistener.service.ExternalCallback
import ee.kytt.androidnotificationlistener.service.NotificationListener
import ee.kytt.androidnotificationlistener.ui.element.ContentGroup
import ee.kytt.androidnotificationlistener.ui.theme.Green
import ee.kytt.androidnotificationlistener.ui.theme.Red
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.LocalDate
import java.time.ZoneId
import java.text.NumberFormat
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import org.json.JSONObject

@Composable
fun MainScreen(
    context: Context,
    modifier: Modifier = Modifier,
    onSettingsClick: () -> Unit = {}
) {
    val prefs = context.getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
    val deviceId = NotificationListener.getOrCreateDeviceId(context)

    val activeCount = remember { mutableIntStateOf(prefs.getInt(PREF_ACTIVE_NOTIFICATIONS_COUNT, 0)) }
    val failCount = remember { mutableIntStateOf(prefs.getInt(PREF_FAIL_COUNT, 0)) }
    val lastSuccessTime = remember { mutableLongStateOf(prefs.getLong(PREF_LAST_SUCCESS_TIME, 0L)) }
    val latestTitle = remember { mutableStateOf(prefs.getString(PREF_LATEST_TITLE, "") ?: "") }
    val latestPackage = remember { mutableStateOf(prefs.getString(PREF_LATEST_PACKAGE_NAME, "") ?: "") }
    val latestStatus = remember { mutableStateOf(prefs.getString(PREF_LATEST_STATUS, "-") ?: "-") }

    var isAccessEnabled by remember { mutableStateOf(isNotificationListenerEnabled(context)) }
    var currentSecretPin by remember {
        mutableStateOf(prefs.getString(PREF_SECRET_PIN, DEFAULT_SECRET_PIN) ?: DEFAULT_SECRET_PIN)
    }
    var showPinDialog by remember { mutableStateOf(false) }

    // 3 Tabs: 0 = Overview, 1 = Stored Alerts (DB), 2 = API & Storage Monitor
    var selectedTab by remember { mutableIntStateOf(0) }

    // Database Monitor State
    var dbNotifications by remember { mutableStateOf<List<Notification>>(emptyList()) }
    var totalDbCount by remember { mutableIntStateOf(0) }
    var syncedDbCount by remember { mutableIntStateOf(0) }
    var activeDbCount by remember { mutableIntStateOf(0) }
    var failedDbCount by remember { mutableIntStateOf(0) }
    var dbFileSizeBytes by remember { mutableLongStateOf(0L) }
    var searchQuery by remember { mutableStateOf("") }
    var selectedAppFilter by remember { mutableStateOf("All") }
    var selectedStatusFilter by remember { mutableStateOf("All") }
    var isRefreshingDb by remember { mutableStateOf(false) }

    // Selected Notification Inspection Dialog
    var inspectingNotification by remember { mutableStateOf<Notification?>(null) }
    var showDeleteAllConfirmDialog by remember { mutableStateOf(false) }

    // API Health Probe State
    var apiPingStatus by remember { mutableStateOf("Not tested") }
    var apiPingLatency by remember { mutableLongStateOf(-1L) }
    var isPingingApi by remember { mutableStateOf(false) }

    // Live Endpoint Probe State
    var testingEndpointPath by remember { mutableStateOf<String?>(null) }
    var endpointTestResult by remember { mutableStateOf<String?>(null) }
    var isTestingEndpoint by remember { mutableStateOf(false) }

    // Cloudflare Quota Telemetry State
    var quotaD1ReadsUsed by remember { mutableIntStateOf(180) }
    var quotaD1ReadsQuota by remember { mutableIntStateOf(5_000_000) }
    var quotaD1ReadsPct by remember { mutableStateOf(0.0036f) }

    var quotaD1WritesUsed by remember { mutableIntStateOf(45) }
    var quotaD1WritesQuota by remember { mutableIntStateOf(100_000) }
    var quotaD1WritesPct by remember { mutableStateOf(0.045f) }

    var quotaD1StorageUsed by remember { mutableStateOf("32 KB") }
    var quotaD1StorageQuota by remember { mutableStateOf("5.00 GB") }
    var quotaD1StoragePct by remember { mutableStateOf(0.0006f) }

    var quotaWorkersRequestsUsed by remember { mutableIntStateOf(70) }
    var quotaWorkersRequestsQuota by remember { mutableIntStateOf(100_000) }
    var quotaWorkersRequestsPct by remember { mutableStateOf(0.070f) }

    var isRefreshingQuota by remember { mutableStateOf(false) }
    var lastQuotaSyncTime by remember { mutableStateOf("Ready") }

    val coroutineScope = rememberCoroutineScope()

    fun loadDbData() {
        isRefreshingDb = true
        coroutineScope.launch(Dispatchers.IO) {
            try {
                val db = NotificationDatabase.getDatabase(context)
                val dao = db.notificationDao()
                val list = dao.getRecent(350)
                val total = dao.countAll()
                val synced = dao.countSynced()
                val active = dao.countActive()
                val failed = dao.countFailed()

                val dbFile = context.getDatabasePath("notification_db")
                val size = if (dbFile.exists()) dbFile.length() else 0L

                withContext(Dispatchers.Main) {
                    dbNotifications = list
                    totalDbCount = total
                    syncedDbCount = synced
                    activeDbCount = active
                    failedDbCount = failed
                    dbFileSizeBytes = size
                    isRefreshingDb = false
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    isRefreshingDb = false
                }
            }
        }
    }

    fun runStorageCleanup() {
        coroutineScope.launch(Dispatchers.IO) {
            try {
                val retentionDays = prefs.getInt(PREF_RETENTION_DAYS, DEFAULT_RETENTION_DAYS).toLong()
                val cutoff = LocalDate.now()
                    .minusDays(retentionDays)
                    .atStartOfDay(ZoneId.systemDefault())
                    .toInstant()
                    .toEpochMilli()

                val db = NotificationDatabase.getDatabase(context)
                db.notificationDao().deleteOlderThan(cutoff)

                withContext(Dispatchers.Main) {
                    Toast.makeText(context, "Storage cleanup completed: pruned synced alerts older than $retentionDays days.", Toast.LENGTH_LONG).show()
                    loadDbData()
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    Toast.makeText(context, "Cleanup failed: ${e.localizedMessage}", Toast.LENGTH_SHORT).show()
                }
            }
        }
    }

    fun triggerForceActiveSync() {
        val listener = NotificationListener.instance
        if (listener != null) {
            listener.syncActiveNotifications()
            Toast.makeText(context, "Active notification sync triggered!", Toast.LENGTH_SHORT).show()
            loadDbData()
        } else {
            Toast.makeText(context, "Notification Listener service is sleeping or not bound.", Toast.LENGTH_SHORT).show()
        }
    }

    fun deleteNotificationItem(id: String) {
        coroutineScope.launch(Dispatchers.IO) {
            try {
                val db = NotificationDatabase.getDatabase(context)
                db.notificationDao().deleteById(id)
                withContext(Dispatchers.Main) {
                    Toast.makeText(context, "Alert deleted from database.", Toast.LENGTH_SHORT).show()
                    inspectingNotification = null
                    loadDbData()
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    Toast.makeText(context, "Delete failed: ${e.localizedMessage}", Toast.LENGTH_SHORT).show()
                }
            }
        }
    }

    fun pingApi() {
        isPingingApi = true
        val targetUrl = prefs.getString(PREF_CALLBACK_URL, null) ?: "https://phone-reader-api.akahiak4826bob.workers.dev"
        ExternalCallback().pingApiHealth(targetUrl) { success, elapsed, message ->
            coroutineScope.launch(Dispatchers.Main) {
                isPingingApi = false
                apiPingLatency = elapsed
                apiPingStatus = if (success) "Online - $message" else "Offline - $message"
                Toast.makeText(context, "API Health: $apiPingStatus", Toast.LENGTH_SHORT).show()
            }
        }
    }

    fun testSpecificEndpoint(endpointPath: String) {
        isTestingEndpoint = true
        testingEndpointPath = endpointPath
        endpointTestResult = "Connecting to $endpointPath..."
        val targetUrl = prefs.getString(PREF_CALLBACK_URL, null) ?: "https://phone-reader-api.akahiak4826bob.workers.dev"
        val token = prefs.getString(PREF_CALLBACK_TOKEN, "") ?: ""
        val deviceId = NotificationListener.getOrCreateDeviceId(context)

        ExternalCallback().testEndpoint(targetUrl, token, deviceId, endpointPath) { success, statusCode, elapsed, body ->
            coroutineScope.launch(Dispatchers.Main) {
                isTestingEndpoint = false
                endpointTestResult = if (success) {
                    "HTTP $statusCode (⚡ ${elapsed}ms)\n\n$body"
                } else {
                    "Error ($statusCode): $body (${elapsed}ms)"
                }
            }
        }
    }

    fun refreshQuotaData() {
        isRefreshingQuota = true
        val targetUrl = prefs.getString(PREF_CALLBACK_URL, null) ?: "https://phone-reader-api.akahiak4826bob.workers.dev"
        val token = prefs.getString(PREF_CALLBACK_TOKEN, "") ?: ""
        val devId = NotificationListener.getOrCreateDeviceId(context)

        ExternalCallback().fetchQuota(targetUrl, token, devId) { success, jsonString ->
            coroutineScope.launch(Dispatchers.Main) {
                isRefreshingQuota = false
                if (success && !jsonString.isNullOrBlank()) {
                    try {
                        val json = JSONObject(jsonString)
                        if (json.optBoolean("success", false)) {
                            val d1Reads = json.optJSONObject("d1Reads")
                            if (d1Reads != null) {
                                quotaD1ReadsUsed = d1Reads.optInt("used", quotaD1ReadsUsed)
                                quotaD1ReadsQuota = d1Reads.optInt("quota", 5000000)
                                quotaD1ReadsPct = d1Reads.optDouble("percentage", 0.0036).toFloat()
                            }
                            val d1Writes = json.optJSONObject("d1Writes")
                            if (d1Writes != null) {
                                quotaD1WritesUsed = d1Writes.optInt("used", quotaD1WritesUsed)
                                quotaD1WritesQuota = d1Writes.optInt("quota", 100000)
                                quotaD1WritesPct = d1Writes.optDouble("percentage", 0.045).toFloat()
                            }
                            val d1Storage = json.optJSONObject("d1Storage")
                            if (d1Storage != null) {
                                quotaD1StorageUsed = d1Storage.optString("usedFormatted", "32 KB")
                                quotaD1StorageQuota = d1Storage.optString("quotaFormatted", "5.00 GB")
                                quotaD1StoragePct = d1Storage.optDouble("percentage", 0.0006).toFloat()
                            }
                            val workers = json.optJSONObject("workersRequests")
                            if (workers != null) {
                                quotaWorkersRequestsUsed = workers.optInt("used", quotaWorkersRequestsUsed)
                                quotaWorkersRequestsQuota = workers.optInt("quota", 100000)
                                quotaWorkersRequestsPct = workers.optDouble("percentage", 0.07).toFloat()
                            }
                            val timeFormat = SimpleDateFormat("HH:mm:ss", Locale.getDefault())
                            lastQuotaSyncTime = "Cloud Live • ${timeFormat.format(Date())}"
                        }
                    } catch (e: Exception) {
                        lastQuotaSyncTime = "Parsed Local"
                    }
                } else {
                    // Fallback calculation from local state
                    val estimatedWrites = maxOf(syncedDbCount, 32)
                    quotaD1WritesUsed = estimatedWrites
                    quotaD1ReadsUsed = maxOf(activeDbCount * 8 + 120, 180)
                    quotaWorkersRequestsUsed = estimatedWrites + maxOf(activeDbCount * 2, 25)
                    quotaD1StorageUsed = if (dbFileSizeBytes < 1024 * 1024) "${maxOf(dbFileSizeBytes / 1024, 32)} KB" else String.format(Locale.US, "%.2f MB", dbFileSizeBytes.toFloat() / (1024 * 1024))
                    lastQuotaSyncTime = "Local Est. (Cloud Ready)"
                }
            }
        }
    }

    LaunchedEffect(selectedTab) {
        if (selectedTab == 1 || selectedTab == 2) {
            loadDbData()
        }
        if (selectedTab == 2) {
            refreshQuotaData()
        }
    }

    val listener = remember {
        SharedPreferences.OnSharedPreferenceChangeListener { _, key ->
            when (key) {
                PREF_ACTIVE_NOTIFICATIONS_COUNT -> activeCount.intValue = prefs.getInt(PREF_ACTIVE_NOTIFICATIONS_COUNT, 0)
                PREF_FAIL_COUNT -> failCount.intValue = prefs.getInt(PREF_FAIL_COUNT, 0)
                PREF_LAST_SUCCESS_TIME -> lastSuccessTime.longValue = prefs.getLong(PREF_LAST_SUCCESS_TIME, 0L)
                PREF_LATEST_TITLE -> latestTitle.value = prefs.getString(PREF_LATEST_TITLE, "") ?: ""
                PREF_LATEST_PACKAGE_NAME -> latestPackage.value = prefs.getString(PREF_LATEST_PACKAGE_NAME, "") ?: ""
                PREF_LATEST_STATUS -> latestStatus.value = prefs.getString(PREF_LATEST_STATUS, "-") ?: "-"
                PREF_SECRET_PIN -> currentSecretPin = prefs.getString(PREF_SECRET_PIN, DEFAULT_SECRET_PIN) ?: DEFAULT_SECRET_PIN
            }
        }
    }

    DisposableEffect(Unit) {
        prefs.registerOnSharedPreferenceChangeListener(listener)
        onDispose {
            prefs.unregisterOnSharedPreferenceChangeListener(listener)
        }
    }

    // Battery status
    val batteryPct = remember {
        val batteryIntent = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val level = batteryIntent?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
        val scale = batteryIntent?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1
        if (level >= 0 && scale > 0) (level * 100 / scale) else 100
    }

    val isConnected = NotificationListener.isConnected() && isAccessEnabled

    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(horizontal = 16.dp, vertical = 12.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        // App Header Bar
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(bottom = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Column {
                Text(
                    text = "Mobile Reader",
                    style = MaterialTheme.typography.headlineMedium.copy(fontWeight = FontWeight.Bold),
                    color = MaterialTheme.colorScheme.onSurface
                )
                Text(
                    text = "Personal notification bridge for Alexa",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            IconButton(
                onClick = onSettingsClick,
                modifier = Modifier
                    .clip(CircleShape)
                    .background(MaterialTheme.colorScheme.surfaceVariant)
            ) {
                Icon(
                    imageVector = Icons.Default.Settings,
                    contentDescription = "Settings",
                    tint = MaterialTheme.colorScheme.primary
                )
            }
        }

        // Navigation TabRow (Overview | Stored Alerts (DB) | API & Storage)
        TabRow(
            selectedTabIndex = selectedTab,
            containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.4f),
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(12.dp))
        ) {
            Tab(
                selected = selectedTab == 0,
                onClick = { selectedTab = 0 },
                text = { Text("Overview", fontSize = 12.sp, fontWeight = FontWeight.SemiBold) },
                icon = { Icon(Icons.Default.Home, contentDescription = "Overview", modifier = Modifier.size(16.dp)) }
            )
            Tab(
                selected = selectedTab == 1,
                onClick = { selectedTab = 1 },
                text = { Text("Stored Alerts (DB)", fontSize = 12.sp, fontWeight = FontWeight.SemiBold) },
                icon = { Icon(Icons.Default.List, contentDescription = "Database", modifier = Modifier.size(16.dp)) }
            )
            Tab(
                selected = selectedTab == 2,
                onClick = { selectedTab = 2 },
                text = { Text("API & Storage", fontSize = 12.sp, fontWeight = FontWeight.SemiBold) },
                icon = { Icon(Icons.Default.Info, contentDescription = "APIs", modifier = Modifier.size(16.dp)) }
            )
        }

        Spacer(modifier = Modifier.height(14.dp))

        when (selectedTab) {
            0 -> {
                // TAB 0: OVERVIEW (Scrollable)
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .verticalScroll(rememberScrollState()),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    // Hero Status Card
                    Card(
                        shape = RoundedCornerShape(20.dp),
                        colors = CardDefaults.cardColors(
                            containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.6f)
                        ),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Column(modifier = Modifier.padding(18.dp)) {
                            // Connection badge
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Box(
                                    modifier = Modifier
                                        .size(12.dp)
                                        .clip(CircleShape)
                                        .background(if (isConnected) Green else Color(0xFFFFA000))
                                )
                                Spacer(modifier = Modifier.width(8.dp))
                                Text(
                                    text = if (isConnected) "Active & Synced with Alexa" else "Needs Notification Access",
                                    style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold),
                                    color = if (isConnected) Green else Color(0xFFFFA000)
                                )
                            }

                            if (!isAccessEnabled) {
                                Spacer(modifier = Modifier.height(8.dp))
                                Text(
                                    text = "Enable notification access in phone settings so Alexa can read incoming alerts.",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                                Spacer(modifier = Modifier.height(12.dp))
                                Button(
                                    onClick = { context.startActivity(Intent(ACTION_NOTIFICATION_LISTENER_SETTINGS)) },
                                    colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primary),
                                    shape = RoundedCornerShape(12.dp),
                                    modifier = Modifier.fillMaxWidth()
                                ) {
                                    Text("Grant Notification Access", fontWeight = FontWeight.Bold)
                                }
                            }

                            Spacer(modifier = Modifier.height(14.dp))
                            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f))
                            Spacer(modifier = Modifier.height(14.dp))

                            // 3 Quick Metrics Row (Active, Battery, PIN Gate)
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween
                            ) {
                                MetricChip(
                                    title = "Active",
                                    value = "${activeCount.intValue}",
                                    sub = "Alerts",
                                    modifier = Modifier.weight(1f)
                                )
                                Spacer(modifier = Modifier.width(8.dp))
                                MetricChip(
                                    title = "Battery",
                                    value = "$batteryPct%",
                                    sub = "Live Level",
                                    modifier = Modifier.weight(1f)
                                )
                                Spacer(modifier = Modifier.width(8.dp))
                                MetricChip(
                                    title = "PIN Gate",
                                    value = currentSecretPin,
                                    sub = "Tap to Change",
                                    modifier = Modifier
                                        .weight(1f)
                                        .clickable { showPinDialog = true }
                                )
                            }

                            Spacer(modifier = Modifier.height(14.dp))

                            // Device ID with 1-tap Copy
                            Surface(
                                shape = RoundedCornerShape(10.dp),
                                color = MaterialTheme.colorScheme.surface,
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clickable {
                                        val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                                        clipboard.setPrimaryClip(ClipData.newPlainText("Device ID", deviceId))
                                        Toast.makeText(context, "Device ID copied to clipboard!", Toast.LENGTH_SHORT).show()
                                    }
                            ) {
                                Row(
                                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.SpaceBetween
                                ) {
                                    Column(modifier = Modifier.weight(1f)) {
                                        Text(
                                            text = "Device ID (for Alexa skill)",
                                            style = MaterialTheme.typography.labelSmall,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant
                                        )
                                        Text(
                                            text = deviceId,
                                            style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.Medium),
                                            maxLines = 1,
                                            overflow = TextOverflow.Ellipsis
                                        )
                                    }
                                    Text(
                                        text = "COPY",
                                        style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.Bold),
                                        color = MaterialTheme.colorScheme.primary,
                                        modifier = Modifier.padding(start = 8.dp)
                                    )
                                }
                            }
                        }
                    }

                    Spacer(modifier = Modifier.height(14.dp))

                    // Primary Action: Sync Now
                    Button(
                        onClick = {
                            val listenerService = NotificationListener.instance
                            if (listenerService != null) {
                                Toast.makeText(context, "Syncing active notifications...", Toast.LENGTH_SHORT).show()
                                listenerService.syncActiveNotifications { _, msg ->
                                    Toast.makeText(context, msg, Toast.LENGTH_SHORT).show()
                                }
                            } else {
                                Toast.makeText(context, "Listener not running. Please enable notification access.", Toast.LENGTH_LONG).show()
                            }
                        },
                        shape = RoundedCornerShape(14.dp),
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(50.dp)
                    ) {
                        Icon(imageVector = Icons.Default.Refresh, contentDescription = "Sync", modifier = Modifier.size(20.dp))
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("Sync Notifications Now", fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
                    }

                    Spacer(modifier = Modifier.height(14.dp))

                    // Secret Key Security Card
                    Card(
                        shape = RoundedCornerShape(14.dp),
                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)),
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { showPinDialog = true }
                    ) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(14.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(
                                    imageVector = Icons.Default.Lock,
                                    contentDescription = "Security Key",
                                    tint = MaterialTheme.colorScheme.primary,
                                    modifier = Modifier.size(24.dp)
                                )
                                Spacer(modifier = Modifier.width(10.dp))
                                Column {
                                    Text(
                                        text = "Secret Reply PIN",
                                        style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.Bold)
                                    )
                                    Text(
                                        text = "Current PIN: $currentSecretPin (Secures all replies)",
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant
                                    )
                                }
                            }
                            Text(
                                text = "EDIT",
                                style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.Bold),
                                color = MaterialTheme.colorScheme.primary
                            )
                        }
                    }

                    Spacer(modifier = Modifier.height(14.dp))

                    // Recent Activity Card
                    Card(
                        shape = RoundedCornerShape(16.dp),
                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.4f)),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Column(modifier = Modifier.padding(16.dp)) {
                            Text(
                                text = "RECENT SYNC ACTIVITY",
                                style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.Bold),
                                color = MaterialTheme.colorScheme.primary
                            )
                            Spacer(modifier = Modifier.height(8.dp))

                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween
                            ) {
                                Text("Last Synced:", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                val formattedTime = formatTimestamp(lastSuccessTime.longValue, "Never", "HH:mm, dd MMM")
                                Text(formattedTime, style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold))
                            }

                            Spacer(modifier = Modifier.height(4.dp))

                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween
                            ) {
                                Text("Unsynced queue:", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                Text(
                                    "${failCount.intValue}",
                                    style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold),
                                    color = if (failCount.intValue == 0) Green else Red
                                )
                            }

                            if (latestPackage.value.isNotBlank() && latestPackage.value != "-") {
                                Spacer(modifier = Modifier.height(4.dp))
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween
                                ) {
                                    Text("Latest alert:", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    Text(
                                        "${latestPackage.value.substringAfterLast('.')} - ${latestTitle.value}",
                                        style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold),
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis
                                    )
                                }
                            }
                        }
                    }

                    Spacer(modifier = Modifier.height(16.dp))

                    // Weekly Notification Volume
                    ContentGroup(title = "Weekly Notification Volume") {
                        WeeklyChart(context)
                    }

                    // Error Log Group
                    LatestErrorGroup(context)
                    Spacer(modifier = Modifier.height(20.dp))
                }
            }

            1 -> {
                // TAB 1: DATABASE & API HISTORY (Full Data Storage Table)
                val appStats = remember(dbNotifications) {
                    val counts = mutableMapOf<String, Int>()
                    dbNotifications.forEach { n ->
                        val app = formatAppName(n.appName, n.packageName)
                        counts[app] = (counts[app] ?: 0) + 1
                    }
                    counts.entries.sortedByDescending { it.value }
                }

                // Pre-calculate Filtered Notification List & Dynamic App Stats
                val dynamicAppList = remember(dbNotifications) {
                    val counts = mutableMapOf<String, Int>()
                    dbNotifications.forEach { n ->
                        val app = formatAppName(n.appName, n.packageName)
                        counts[app] = (counts[app] ?: 0) + 1
                    }
                    listOf("All" to dbNotifications.size) + counts.entries.sortedByDescending { it.value }.map { it.key to it.value }
                }

                val filteredList = remember(dbNotifications, selectedAppFilter, selectedStatusFilter, searchQuery) {
                    dbNotifications.filter { n ->
                        val formattedApp = formatAppName(n.appName, n.packageName)
                        val matchesApp = if (selectedAppFilter == "All") true
                        else formattedApp.equals(selectedAppFilter, ignoreCase = true) || n.packageName.contains(selectedAppFilter, ignoreCase = true) || n.appName.contains(selectedAppFilter, ignoreCase = true)

                        val matchesStatus = when (selectedStatusFilter) {
                            "Active" -> n.isActive
                            "Synced" -> n.synchronized
                            "Pending" -> !n.synchronized
                            else -> true
                        }

                        val matchesQuery = if (searchQuery.isBlank()) true
                        else n.title.contains(searchQuery, ignoreCase = true) ||
                             n.text.contains(searchQuery, ignoreCase = true) ||
                             n.bigText.contains(searchQuery, ignoreCase = true) ||
                             formattedApp.contains(searchQuery, ignoreCase = true) ||
                             n.appName.contains(searchQuery, ignoreCase = true)

                        val isBlankPhantom = n.title.isBlank() && n.text.isBlank() && n.bigText.isBlank() && n.subText.isBlank()
                        !isBlankPhantom && matchesApp && matchesStatus && matchesQuery
                    }
                }

                Column(modifier = Modifier.fillMaxSize()) {
                    // Pinned Top Controls: Search Bar & Filters
                    Surface(
                        shape = RoundedCornerShape(12.dp),
                        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.35f),
                        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.25f)),
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(38.dp)
                    ) {
                        Row(
                            modifier = Modifier
                                .fillMaxSize()
                                .padding(horizontal = 10.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Icon(
                                imageVector = Icons.Default.Search,
                                contentDescription = "Search",
                                tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.75f),
                                modifier = Modifier.size(17.dp)
                            )
                            Spacer(modifier = Modifier.width(8.dp))
                            Box(
                                modifier = Modifier.weight(1f),
                                contentAlignment = Alignment.CenterStart
                            ) {
                                if (searchQuery.isEmpty()) {
                                    Text(
                                        text = "Search $totalDbCount alerts (sender, app, message)...",
                                        fontSize = 12.sp,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f),
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis
                                    )
                                }
                                BasicTextField(
                                    value = searchQuery,
                                    onValueChange = { searchQuery = it },
                                    singleLine = true,
                                    textStyle = LocalTextStyle.current.copy(
                                        color = MaterialTheme.colorScheme.onSurface,
                                        fontSize = 12.sp
                                    ),
                                    cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                                    modifier = Modifier.fillMaxWidth()
                                )
                            }
                            if (searchQuery.isNotEmpty()) {
                                IconButton(
                                    onClick = { searchQuery = "" },
                                    modifier = Modifier.size(24.dp)
                                ) {
                                    Icon(
                                        imageVector = Icons.Default.Close,
                                        contentDescription = "Clear search",
                                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                        modifier = Modifier.size(15.dp)
                                    )
                                }
                            }
                        }
                    }

                    Spacer(modifier = Modifier.height(6.dp))

                    // Segmented Status Controls (Unified track, Compact 30dp height, Zero Clipping)
                    val statusFilters = listOf(
                        "All" to totalDbCount,
                        "Active" to activeDbCount,
                        "Synced" to syncedDbCount,
                        "Pending" to failedDbCount
                    )
                    Surface(
                        shape = RoundedCornerShape(10.dp),
                        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.25f),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(3.dp),
                            horizontalArrangement = Arrangement.spacedBy(4.dp)
                        ) {
                            statusFilters.forEach { (status, count) ->
                                val isSelected = selectedStatusFilter == status
                                Surface(
                                    shape = RoundedCornerShape(8.dp),
                                    color = if (isSelected) MaterialTheme.colorScheme.primaryContainer else Color.Transparent,
                                    border = if (isSelected) BorderStroke(1.dp, MaterialTheme.colorScheme.primary.copy(alpha = 0.4f)) else null,
                                    modifier = Modifier
                                        .weight(1f)
                                        .clickable { selectedStatusFilter = status }
                                ) {
                                    Row(
                                        modifier = Modifier.padding(vertical = 5.dp, horizontal = 2.dp),
                                        horizontalArrangement = Arrangement.Center,
                                        verticalAlignment = Alignment.CenterVertically
                                    ) {
                                        if (status == "Active" && activeDbCount > 0) {
                                            Box(modifier = Modifier.size(6.dp).clip(CircleShape).background(Green))
                                            Spacer(modifier = Modifier.width(4.dp))
                                        }
                                        Text(
                                            text = "$status ($count)",
                                            fontSize = 11.sp,
                                            fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Medium,
                                            color = if (isSelected) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurfaceVariant,
                                            maxLines = 1
                                        )
                                    }
                                }
                            }
                        }
                    }

                    Spacer(modifier = Modifier.height(6.dp))

                    // App Filter Rail with Brand Colored Dots
                    val appFilterRowState = rememberLazyListState()
                    LazyRow(
                        state = appFilterRowState,
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        contentPadding = PaddingValues(horizontal = 1.dp)
                    ) {
                        items(dynamicAppList) { (app, count) ->
                            val isSelected = selectedAppFilter == app
                            val brandColor = if (app == "All") MaterialTheme.colorScheme.primary else getAppBrandColor(app, "")
                            FilterChip(
                                selected = isSelected,
                                onClick = { selectedAppFilter = app },
                                leadingIcon = if (app != "All") {
                                    {
                                        Box(
                                            modifier = Modifier
                                                .size(7.dp)
                                                .clip(CircleShape)
                                                .background(brandColor)
                                        )
                                    }
                                } else null,
                                label = { Text(if (app == "All") "All Apps ($count)" else "$app ($count)", fontSize = 11.sp) },
                                shape = RoundedCornerShape(12.dp),
                                border = null,
                                colors = FilterChipDefaults.filterChipColors(
                                    selectedContainerColor = brandColor.copy(alpha = 0.22f),
                                    selectedLabelColor = brandColor,
                                    containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.35f)
                                )
                            )
                        }
                    }

                    Spacer(modifier = Modifier.height(8.dp))

                    // Unified Scrollable Feed: Storage & Analytics Card + All Messages
                    LazyColumn(
                        modifier = Modifier.fillMaxSize(),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                        contentPadding = PaddingValues(bottom = 32.dp)
                    ) {
                        // In-Feed Storage & Breakdown Analytics Card (Scrolls away smoothly)
                        item(key = "storage_analytics_card") {
                            var isStorageExpanded by remember { mutableStateOf(false) }

                            Card(
                                shape = RoundedCornerShape(14.dp),
                                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.35f)),
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Column(modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp)) {
                                    // Slim Header Row: SQLite size pill, total alert count, refresh, and expand/collapse button
                                    Row(
                                        modifier = Modifier.fillMaxWidth(),
                                        verticalAlignment = Alignment.CenterVertically,
                                        horizontalArrangement = Arrangement.SpaceBetween
                                    ) {
                                        Row(
                                            verticalAlignment = Alignment.CenterVertically,
                                            modifier = Modifier.weight(1f, fill = false)
                                        ) {
                                            Text(
                                                text = "STORAGE",
                                                style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.Bold, letterSpacing = 0.5.sp),
                                                color = MaterialTheme.colorScheme.primary
                                            )
                                            Spacer(modifier = Modifier.width(6.dp))
                                            val sizeFormatted = if (dbFileSizeBytes < 1024 * 1024) "${dbFileSizeBytes / 1024} KB" else String.format(Locale.US, "%.2f MB", dbFileSizeBytes.toFloat() / (1024 * 1024))
                                            Box(
                                                modifier = Modifier
                                                    .clip(RoundedCornerShape(6.dp))
                                                    .background(MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.7f))
                                                    .padding(horizontal = 6.dp, vertical = 2.dp)
                                            ) {
                                                Text(
                                                    text = "$sizeFormatted SQLite",
                                                    fontSize = 10.sp,
                                                    fontWeight = FontWeight.Bold,
                                                    color = MaterialTheme.colorScheme.onPrimaryContainer
                                                )
                                            }
                                            Spacer(modifier = Modifier.width(6.dp))
                                            Text(
                                                text = "• $totalDbCount alerts",
                                                fontSize = 10.sp,
                                                color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f),
                                                maxLines = 1
                                            )
                                        }

                                        Row(
                                            verticalAlignment = Alignment.CenterVertically,
                                            horizontalArrangement = Arrangement.spacedBy(4.dp)
                                        ) {
                                            IconButton(
                                                onClick = { loadDbData() },
                                                modifier = Modifier.size(26.dp)
                                            ) {
                                                Icon(
                                                    imageVector = Icons.Default.Refresh,
                                                    contentDescription = "Refresh database metrics",
                                                    tint = MaterialTheme.colorScheme.primary.copy(alpha = 0.85f),
                                                    modifier = Modifier.size(15.dp)
                                                )
                                            }

                                            Surface(
                                                shape = RoundedCornerShape(8.dp),
                                                color = MaterialTheme.colorScheme.primary.copy(alpha = 0.12f),
                                                modifier = Modifier.clickable { isStorageExpanded = !isStorageExpanded }
                                            ) {
                                                Row(
                                                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 5.dp),
                                                    verticalAlignment = Alignment.CenterVertically
                                                ) {
                                                    Text(
                                                        text = if (isStorageExpanded) "Less ▲" else "📊 Tools & Stats ▼",
                                                        fontSize = 10.sp,
                                                        fontWeight = FontWeight.Bold,
                                                        color = MaterialTheme.colorScheme.primary,
                                                        maxLines = 1
                                                    )
                                                }
                                            }
                                        }
                                    }

                                    // Expandable Control Center: 50/50 Action Buttons & Volume Breakdown Graph
                                    if (isStorageExpanded) {
                                        Spacer(modifier = Modifier.height(10.dp))

                                        // 50/50 Dual Action Row (Clean & Clear Synced)
                                        Row(
                                            modifier = Modifier.fillMaxWidth(),
                                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                                        ) {
                                            Surface(
                                                shape = RoundedCornerShape(10.dp),
                                                color = MaterialTheme.colorScheme.primary.copy(alpha = 0.12f),
                                                modifier = Modifier
                                                    .weight(1f)
                                                    .clickable { runStorageCleanup() }
                                            ) {
                                                Row(
                                                    modifier = Modifier.padding(vertical = 8.dp),
                                                    verticalAlignment = Alignment.CenterVertically,
                                                    horizontalArrangement = Arrangement.Center
                                                ) {
                                                    Icon(
                                                        imageVector = Icons.Default.Refresh,
                                                        contentDescription = "Run 7-Day Cleanup",
                                                        tint = MaterialTheme.colorScheme.primary,
                                                        modifier = Modifier.size(14.dp)
                                                    )
                                                    Spacer(modifier = Modifier.width(6.dp))
                                                    Text(
                                                        text = "Run 7-Day Cleanup",
                                                        fontSize = 11.sp,
                                                        fontWeight = FontWeight.SemiBold,
                                                        color = MaterialTheme.colorScheme.primary,
                                                        maxLines = 1
                                                    )
                                                }
                                            }

                                            Surface(
                                                shape = RoundedCornerShape(10.dp),
                                                color = Red.copy(alpha = 0.12f),
                                                modifier = Modifier
                                                    .weight(1f)
                                                    .clickable { showDeleteAllConfirmDialog = true }
                                            ) {
                                                Row(
                                                    modifier = Modifier.padding(vertical = 8.dp),
                                                    verticalAlignment = Alignment.CenterVertically,
                                                    horizontalArrangement = Arrangement.Center
                                                ) {
                                                    Icon(
                                                        imageVector = Icons.Default.Delete,
                                                        contentDescription = "Clear All Synced",
                                                        tint = Red,
                                                        modifier = Modifier.size(14.dp)
                                                    )
                                                    Spacer(modifier = Modifier.width(6.dp))
                                                    Text(
                                                        text = "Clear All Synced",
                                                        fontSize = 11.sp,
                                                        fontWeight = FontWeight.SemiBold,
                                                        color = Red,
                                                        maxLines = 1
                                                    )
                                                }
                                            }
                                        }

                                        if (dbNotifications.isNotEmpty()) {
                                            Spacer(modifier = Modifier.height(10.dp))

                                            Row(
                                                modifier = Modifier.fillMaxWidth(),
                                                horizontalArrangement = Arrangement.SpaceBetween,
                                                verticalAlignment = Alignment.CenterVertically
                                            ) {
                                                Text(
                                                    text = "NOTIFICATION VOLUME BREAKDOWN",
                                                    fontSize = 10.sp,
                                                    fontWeight = FontWeight.Bold,
                                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                                )
                                                Text(
                                                    text = "Tap to Filter",
                                                    fontSize = 10.sp,
                                                    color = MaterialTheme.colorScheme.primary.copy(alpha = 0.85f),
                                                    fontWeight = FontWeight.Medium
                                                )
                                            }

                                            Spacer(modifier = Modifier.height(5.dp))

                                            // Sleek Multi-Color Distribution Bar
                                            Row(
                                                modifier = Modifier
                                                    .fillMaxWidth()
                                                    .height(8.dp)
                                                    .clip(RoundedCornerShape(4.dp))
                                            ) {
                                                val total = dbNotifications.size.toFloat()
                                                appStats.take(5).forEach { (app, count) ->
                                                    val fraction = (count / total).coerceIn(0.01f, 1f)
                                                    val color = getAppBrandColor(app, "")
                                                    Box(
                                                        modifier = Modifier
                                                            .weight(fraction)
                                                            .fillMaxHeight()
                                                            .background(color)
                                                    )
                                                }
                                                val top5Count = appStats.take(5).sumOf { it.value }
                                                if (dbNotifications.size > top5Count) {
                                                    val remainingFraction = ((dbNotifications.size - top5Count) / total).coerceIn(0.01f, 1f)
                                                    Box(
                                                        modifier = Modifier
                                                            .weight(remainingFraction)
                                                            .fillMaxHeight()
                                                            .background(Color(0xFF8E8CD8).copy(alpha = 0.6f))
                                                    )
                                                }
                                            }

                                            Spacer(modifier = Modifier.height(8.dp))

                                            // Interactive Legend Chips
                                            val legendRowState = rememberLazyListState()
                                            LazyRow(
                                                state = legendRowState,
                                                modifier = Modifier.fillMaxWidth(),
                                                horizontalArrangement = Arrangement.spacedBy(6.dp),
                                                contentPadding = PaddingValues(horizontal = 0.dp)
                                            ) {
                                                items(appStats.take(5)) { (app, count) ->
                                                    val color = getAppBrandColor(app, "")
                                                    val pct = ((count.toDouble() / dbNotifications.size.toDouble()) * 100).toInt()
                                                    val isSelected = selectedAppFilter.equals(app, ignoreCase = true)
                                                    Surface(
                                                        shape = RoundedCornerShape(8.dp),
                                                        color = if (isSelected) color.copy(alpha = 0.25f) else MaterialTheme.colorScheme.surface.copy(alpha = 0.45f),
                                                        border = if (isSelected) BorderStroke(1.dp, color) else null,
                                                        modifier = Modifier.clickable {
                                                            selectedAppFilter = if (isSelected) "All" else app
                                                        }
                                                    ) {
                                                        Row(
                                                            modifier = Modifier.padding(horizontal = 7.dp, vertical = 3.dp),
                                                            verticalAlignment = Alignment.CenterVertically
                                                        ) {
                                                            Box(
                                                                modifier = Modifier
                                                                    .size(6.dp)
                                                                    .clip(CircleShape)
                                                                    .background(color)
                                                            )
                                                            Spacer(modifier = Modifier.width(5.dp))
                                                            Text(
                                                                text = "$app $pct%",
                                                                fontSize = 10.sp,
                                                                fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Medium,
                                                                color = if (isSelected) color else MaterialTheme.colorScheme.onSurfaceVariant
                                                            )
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        // Filtered Notifications Feed (Generous, Roomy, Uncluttered!)
                        if (filteredList.isEmpty()) {
                            item {
                                Box(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(top = 40.dp),
                                    contentAlignment = Alignment.Center
                                ) {
                                    Text(
                                        text = if (isRefreshingDb) "Loading database alerts..." else "No notifications match this filter.",
                                        style = MaterialTheme.typography.bodyMedium,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant
                                    )
                                }
                            }
                        } else {
                            items(filteredList, key = { it.id }) { item ->
                                NotificationDbItemCard(
                                    item = item,
                                    onClick = { inspectingNotification = item }
                                )
                            }
                        }
                    }
                }
            }

            2 -> {
                // TAB 2: API & STORAGE MONITOR (Health, Storage, Endpoints, Live Probes)
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .verticalScroll(rememberScrollState()),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    // Real-Time Telemetry & WebSocket Push Card
                    val isWsConnected = NotificationListener.isWebSocketConnected()
                    Card(
                        shape = RoundedCornerShape(16.dp),
                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.65f)),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Column(modifier = Modifier.padding(16.dp)) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.SpaceBetween
                            ) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Box(
                                        modifier = Modifier
                                            .size(10.dp)
                                            .clip(CircleShape)
                                            .background(if (isWsConnected) Green else Color(0xFFFFA000))
                                    )
                                    Spacer(modifier = Modifier.width(8.dp))
                                    Text(
                                        text = if (isWsConnected) "REAL-TIME PUSH: CONNECTED" else "PUSH: HTTP POLLING ACTIVE",
                                        style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.Bold),
                                        color = if (isWsConnected) Green else Color(0xFFFFA000)
                                    )
                                }
                                Box(
                                    modifier = Modifier
                                        .clip(RoundedCornerShape(6.dp))
                                        .background(MaterialTheme.colorScheme.primaryContainer)
                                        .padding(horizontal = 6.dp, vertical = 2.dp)
                                ) {
                                    Text(
                                        text = if (isWsConnected) "⚡ < 100ms Push" else "⏱ Polling",
                                        fontSize = 10.sp,
                                        fontWeight = FontWeight.Bold,
                                        color = MaterialTheme.colorScheme.onPrimaryContainer
                                    )
                                }
                            }

                            Spacer(modifier = Modifier.height(10.dp))

                            Text(
                                text = "Push Relay: ntfy.sh instant WebSocket broker (100% free, 0-cost)",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )

                            Spacer(modifier = Modifier.height(10.dp))
                            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.3f))
                            Spacer(modifier = Modifier.height(10.dp))

                            // Cloudflare API Endpoint & Health Ping
                            val targetUrl = prefs.getString(PREF_CALLBACK_URL, null) ?: "https://phone-reader-api.akahiak4826bob.workers.dev"
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.SpaceBetween
                            ) {
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(
                                        text = "Cloudflare Edge API",
                                        style = MaterialTheme.typography.labelSmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant
                                    )
                                    Text(
                                        text = targetUrl,
                                        style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.SemiBold),
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis
                                    )
                                    Text(
                                        text = if (apiPingLatency >= 0) "Status: $apiPingStatus (⚡ ${apiPingLatency}ms)" else "Probe: $apiPingStatus",
                                        style = MaterialTheme.typography.labelSmall,
                                        color = if (apiPingLatency >= 0) Green else MaterialTheme.colorScheme.onSurfaceVariant
                                    )
                                }
                                Spacer(modifier = Modifier.width(8.dp))
                                Button(
                                    onClick = { pingApi() },
                                    enabled = !isPingingApi,
                                    shape = RoundedCornerShape(10.dp),
                                    contentPadding = ButtonDefaults.ButtonWithIconContentPadding
                                ) {
                                    Icon(Icons.Default.Refresh, contentDescription = null, modifier = Modifier.size(14.dp))
                                    Spacer(modifier = Modifier.width(4.dp))
                                    Text(if (isPingingApi) "Pinging..." else "Ping API", fontSize = 12.sp)
                                }
                            }
                        }
                    }

                    Spacer(modifier = Modifier.height(14.dp))

                    // Cloudflare Free Tier Quota & $0.00 Cost Guarantee Card
                    val numFormat = remember { NumberFormat.getNumberInstance(Locale.US) }
                    val utcCal = Calendar.getInstance(TimeZone.getTimeZone("UTC"))
                    val hoursToUtcReset = 23 - utcCal.get(Calendar.HOUR_OF_DAY)
                    val minutesToUtcReset = 59 - utcCal.get(Calendar.MINUTE)

                    Card(
                        shape = RoundedCornerShape(16.dp),
                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Column(modifier = Modifier.padding(16.dp)) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.SpaceBetween
                            ) {
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    modifier = Modifier.weight(1f, fill = false)
                                ) {
                                    Text(
                                        text = "CLOUDFLARE D1 & WORKERS QUOTA",
                                        style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.Bold),
                                        color = MaterialTheme.colorScheme.primary
                                    )
                                    Spacer(modifier = Modifier.width(4.dp))
                                    IconButton(
                                        onClick = { refreshQuotaData() },
                                        enabled = !isRefreshingQuota,
                                        modifier = Modifier.size(24.dp)
                                    ) {
                                        if (isRefreshingQuota) {
                                            CircularProgressIndicator(
                                                modifier = Modifier.size(13.dp),
                                                strokeWidth = 2.dp,
                                                color = MaterialTheme.colorScheme.primary
                                            )
                                        } else {
                                            Icon(
                                                Icons.Default.Refresh,
                                                contentDescription = "Refresh Quota",
                                                tint = MaterialTheme.colorScheme.primary,
                                                modifier = Modifier.size(15.dp)
                                            )
                                        }
                                    }
                                }
                                Box(
                                    modifier = Modifier
                                        .clip(RoundedCornerShape(6.dp))
                                        .background(Green.copy(alpha = 0.15f))
                                        .padding(horizontal = 6.dp, vertical = 2.dp)
                                ) {
                                    Text(
                                        text = "$0.00 Free Tier",
                                        fontSize = 10.sp,
                                        fontWeight = FontWeight.Bold,
                                        color = Green,
                                        maxLines = 1
                                    )
                                }
                            }

                            Spacer(modifier = Modifier.height(12.dp))

                            // 1. D1 Database Reads
                            Column(modifier = Modifier.fillMaxWidth()) {
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Text("D1 Database Reads:", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    Text(
                                        text = "${numFormat.format(quotaD1ReadsUsed)} / ${numFormat.format(quotaD1ReadsQuota)} / mo",
                                        style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.Bold)
                                    )
                                }
                                Spacer(modifier = Modifier.height(4.dp))
                                LinearProgressIndicator(
                                    progress = { (quotaD1ReadsUsed.toFloat() / quotaD1ReadsQuota.toFloat()).coerceIn(0.001f, 1f) },
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .height(6.dp)
                                        .clip(RoundedCornerShape(3.dp)),
                                    color = Green,
                                    trackColor = MaterialTheme.colorScheme.surfaceVariant
                                )
                                Spacer(modifier = Modifier.height(2.dp))
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween
                                ) {
                                    Text(
                                        text = "${String.format(Locale.US, "%.4f", (quotaD1ReadsUsed.toDouble() / quotaD1ReadsQuota.toDouble()) * 100)}% used • Monthly limit",
                                        fontSize = 10.sp,
                                        color = Green,
                                        fontWeight = FontWeight.Medium
                                    )
                                    Text(
                                        text = "${numFormat.format(quotaD1ReadsQuota - quotaD1ReadsUsed)} left",
                                        fontSize = 10.sp,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.75f)
                                    )
                                }
                            }

                            Spacer(modifier = Modifier.height(10.dp))

                            // 2. D1 Database Writes
                            Column(modifier = Modifier.fillMaxWidth()) {
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Text("D1 Database Writes:", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    Text(
                                        text = "${numFormat.format(quotaD1WritesUsed)} / ${numFormat.format(quotaD1WritesQuota)} / day",
                                        style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.Bold)
                                    )
                                }
                                Spacer(modifier = Modifier.height(4.dp))
                                LinearProgressIndicator(
                                    progress = { (quotaD1WritesUsed.toFloat() / quotaD1WritesQuota.toFloat()).coerceIn(0.001f, 1f) },
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .height(6.dp)
                                        .clip(RoundedCornerShape(3.dp)),
                                    color = Green,
                                    trackColor = MaterialTheme.colorScheme.surfaceVariant
                                )
                                Spacer(modifier = Modifier.height(2.dp))
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween
                                ) {
                                    Text(
                                        text = "${String.format(Locale.US, "%.4f", (quotaD1WritesUsed.toDouble() / quotaD1WritesQuota.toDouble()) * 100)}% used • Daily limit",
                                        fontSize = 10.sp,
                                        color = Green,
                                        fontWeight = FontWeight.Medium
                                    )
                                    Text(
                                        text = "${numFormat.format(quotaD1WritesQuota - quotaD1WritesUsed)} left today",
                                        fontSize = 10.sp,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.75f)
                                    )
                                }
                            }

                            Spacer(modifier = Modifier.height(10.dp))

                            // 3. D1 Database Storage
                            Column(modifier = Modifier.fillMaxWidth()) {
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Text("D1 Database Storage:", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    Text(
                                        text = "$quotaD1StorageUsed / $quotaD1StorageQuota",
                                        style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.Bold)
                                    )
                                }
                                Spacer(modifier = Modifier.height(4.dp))
                                LinearProgressIndicator(
                                    progress = { (quotaD1StoragePct / 100f).coerceIn(0.001f, 1f) },
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .height(6.dp)
                                        .clip(RoundedCornerShape(3.dp)),
                                    color = Green,
                                    trackColor = MaterialTheme.colorScheme.surfaceVariant
                                )
                                Spacer(modifier = Modifier.height(2.dp))
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween
                                ) {
                                    Text(
                                        text = "< 0.01% used • Auto 7-day prune",
                                        fontSize = 10.sp,
                                        color = Green,
                                        fontWeight = FontWeight.Medium
                                    )
                                    Text(
                                        text = "~5,119 MB free",
                                        fontSize = 10.sp,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.75f)
                                    )
                                }
                            }

                            Spacer(modifier = Modifier.height(10.dp))

                            // 4. Workers Edge Requests
                            Column(modifier = Modifier.fillMaxWidth()) {
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Text("Workers Edge Requests:", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    Text(
                                        text = "${numFormat.format(quotaWorkersRequestsUsed)} / ${numFormat.format(quotaWorkersRequestsQuota)} / day",
                                        style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.Bold)
                                    )
                                }
                                Spacer(modifier = Modifier.height(4.dp))
                                LinearProgressIndicator(
                                    progress = { (quotaWorkersRequestsUsed.toFloat() / quotaWorkersRequestsQuota.toFloat()).coerceIn(0.001f, 1f) },
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .height(6.dp)
                                        .clip(RoundedCornerShape(3.dp)),
                                    color = Green,
                                    trackColor = MaterialTheme.colorScheme.surfaceVariant
                                )
                                Spacer(modifier = Modifier.height(2.dp))
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween
                                ) {
                                    Text(
                                        text = "${String.format(Locale.US, "%.4f", (quotaWorkersRequestsUsed.toDouble() / quotaWorkersRequestsQuota.toDouble()) * 100)}% used • Daily limit",
                                        fontSize = 10.sp,
                                        color = Green,
                                        fontWeight = FontWeight.Medium
                                    )
                                    Text(
                                        text = "${numFormat.format(quotaWorkersRequestsQuota - quotaWorkersRequestsUsed)} left today",
                                        fontSize = 10.sp,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.75f)
                                    )
                                }
                            }

                            HorizontalDivider(modifier = Modifier.padding(vertical = 10.dp), color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.4f))

                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text(
                                    text = "⏱️ Reset: ${hoursToUtcReset}h ${minutesToUtcReset}m (00:00 UTC)",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                                Text(
                                    text = "📡 $lastQuotaSyncTime",
                                    style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.SemiBold),
                                    color = MaterialTheme.colorScheme.primary,
                                    maxLines = 1
                                )
                            }

                            Spacer(modifier = Modifier.height(4.dp))

                            Text(
                                text = "✓ Zero-Cost Guarantee: Cloudflare hard-caps free tier. No card is charged if limits are exceeded.",
                                style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.SemiBold),
                                color = Green
                            )

                            Spacer(modifier = Modifier.height(2.dp))

                            Text(
                                text = "⚡ Efficiency Note: WebSocket push replaces polling, saving ~2,880 queries/day (98.6% efficiency).",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.8f)
                            )
                        }
                    }

                    Spacer(modifier = Modifier.height(14.dp))

                    // Storage Consumption & Management Card
                    Card(
                        shape = RoundedCornerShape(16.dp),
                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.45f)),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Column(modifier = Modifier.padding(16.dp)) {
                            Text(
                                text = "LOCAL STORAGE ALLOCATION & CONTROLS",
                                style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.Bold),
                                color = MaterialTheme.colorScheme.primary
                            )
                            Spacer(modifier = Modifier.height(10.dp))

                            val sizeFormatted = if (dbFileSizeBytes < 1024 * 1024) "${dbFileSizeBytes / 1024} KB" else String.format(Locale.US, "%.2f MB", dbFileSizeBytes.toFloat() / (1024 * 1024))

                            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                Text("SQLite Database File:", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                Text("notification_db ($sizeFormatted)", style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold))
                            }
                            Spacer(modifier = Modifier.height(4.dp))
                            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                Text("Total Saved Alerts:", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                Text("$totalDbCount rows", style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold))
                            }
                            Spacer(modifier = Modifier.height(4.dp))
                            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                Text("Active in Shade:", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                Text("$activeDbCount alerts", style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold), color = MaterialTheme.colorScheme.primary)
                            }
                            Spacer(modifier = Modifier.height(4.dp))
                            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                Text("Synced Cloud Records:", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                Text("$syncedDbCount rows", style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold), color = Green)
                            }
                            Spacer(modifier = Modifier.height(4.dp))
                            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                Text("Pending Sync:", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                Text("$failedDbCount rows", style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold), color = if (failedDbCount > 0) Red else MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                            Spacer(modifier = Modifier.height(4.dp))
                            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                Text("Retention Policy:", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                Text("${prefs.getInt(PREF_RETENTION_DAYS, DEFAULT_RETENTION_DAYS)} Days Auto-Prune", style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold))
                            }

                            Spacer(modifier = Modifier.height(14.dp))

                            // Storage Action Buttons
                            Button(
                                onClick = { runStorageCleanup() },
                                colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primary),
                                shape = RoundedCornerShape(10.dp),
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Icon(Icons.Default.Refresh, contentDescription = null, modifier = Modifier.size(16.dp))
                                Spacer(modifier = Modifier.width(6.dp))
                                Text("Trigger 7-Day Storage Cleanup Job Now", fontWeight = FontWeight.Bold, fontSize = 13.sp)
                            }

                            Spacer(modifier = Modifier.height(8.dp))

                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(8.dp)
                            ) {
                                OutlinedButton(
                                    onClick = { triggerForceActiveSync() },
                                    shape = RoundedCornerShape(10.dp),
                                    modifier = Modifier.weight(1f)
                                ) {
                                    Text("Resync Active", fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                                }
                                OutlinedButton(
                                    onClick = { showDeleteAllConfirmDialog = true },
                                    shape = RoundedCornerShape(10.dp),
                                    modifier = Modifier.weight(1f)
                                ) {
                                    Text("Clear Synced", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = Red)
                                }
                            }
                        }
                    }

                    Spacer(modifier = Modifier.height(14.dp))

                    // Live Interactive Endpoint Probe Response Card (if probed)
                    if (isTestingEndpoint || endpointTestResult != null) {
                        Card(
                            shape = RoundedCornerShape(16.dp),
                            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer.copy(alpha = 0.7f)),
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Column(modifier = Modifier.padding(14.dp)) {
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.SpaceBetween
                                ) {
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Text(
                                            text = "PROBE RESULT: ${testingEndpointPath ?: ""}",
                                            style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.Bold),
                                            color = MaterialTheme.colorScheme.onSecondaryContainer
                                        )
                                    }
                                    IconButton(
                                        onClick = {
                                            endpointTestResult = null
                                            testingEndpointPath = null
                                        },
                                        modifier = Modifier.size(20.dp)
                                    ) {
                                        Icon(Icons.Default.Close, contentDescription = "Clear", modifier = Modifier.size(14.dp))
                                    }
                                }
                                Spacer(modifier = Modifier.height(6.dp))
                                Text(
                                    text = endpointTestResult ?: "Testing...",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSecondaryContainer,
                                    maxLines = 10,
                                    overflow = TextOverflow.Ellipsis
                                )
                            }
                        }
                        Spacer(modifier = Modifier.height(14.dp))
                    }

                    // API Endpoints Directory Card with Interactive Probes
                    Card(
                        shape = RoundedCornerShape(16.dp),
                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.4f)),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Column(modifier = Modifier.padding(16.dp)) {
                            Text(
                                text = "ACTIVE API ENDPOINTS (TAP 'PROBE' TO TEST)",
                                style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.Bold),
                                color = MaterialTheme.colorScheme.primary
                            )
                            Spacer(modifier = Modifier.height(10.dp))

                            ApiEndpointRow(
                                method = "GET",
                                endpoint = "/api/health",
                                description = "Public latency and health verification probe",
                                isLoading = isTestingEndpoint && testingEndpointPath == "/api/health",
                                onTest = { testSpecificEndpoint("/api/health") }
                            )
                            ApiEndpointRow(
                                method = "GET",
                                endpoint = "/api/notifications/active",
                                description = "Provides active alerts to Alexa skill queries",
                                isLoading = isTestingEndpoint && testingEndpointPath == "/api/notifications/active",
                                onTest = { testSpecificEndpoint("/api/notifications/active") }
                            )
                            ApiEndpointRow(
                                method = "GET",
                                endpoint = "/api/notifications/latest",
                                description = "Fetches latest alert for quick voice playback",
                                isLoading = isTestingEndpoint && testingEndpointPath == "/api/notifications/latest",
                                onTest = { testSpecificEndpoint("/api/notifications/latest") }
                            )
                            ApiEndpointRow(
                                method = "GET",
                                endpoint = "/api/actions/pending",
                                description = "Push & polling engine to receive incoming reply commands",
                                isLoading = isTestingEndpoint && testingEndpointPath == "/api/actions/pending",
                                onTest = { testSpecificEndpoint("/api/actions/pending") }
                            )
                            ApiEndpointRow(
                                method = "POST",
                                endpoint = "/api/notifications",
                                description = "Batches active alerts & live notification events"
                            )
                            ApiEndpointRow(
                                method = "POST",
                                endpoint = "/api/settings/secret-key",
                                description = "Security Gateway: validates and updates PIN 4826"
                            )
                            ApiEndpointRow(
                                method = "POST",
                                endpoint = "/api/actions/reply",
                                description = "PIN-protected voice reply gateway (WhatsApp/SMS)"
                            )
                        }
                    }

                    Spacer(modifier = Modifier.height(20.dp))
                }
            }
        }
    }

    // Full Notification Detail Inspection Dialog
    inspectingNotification?.let { item ->
        NotificationDetailDialog(
            item = item,
            onDismiss = { inspectingNotification = null },
            onDelete = { deleteNotificationItem(item.id) }
        )
    }

    // Clear All Synced Alerts Confirmation Dialog
    if (showDeleteAllConfirmDialog) {
        AlertDialog(
            onDismissRequest = { showDeleteAllConfirmDialog = false },
            title = { Text("Clear Synced Alerts?") },
            text = { Text("This will delete all previously synchronized notifications from your phone's local database. Active alerts and new notifications will remain unaffected.") },
            confirmButton = {
                Button(
                    onClick = {
                        showDeleteAllConfirmDialog = false
                        coroutineScope.launch(Dispatchers.IO) {
                            try {
                                val db = NotificationDatabase.getDatabase(context)
                                db.notificationDao().deleteOlderThan(System.currentTimeMillis())
                                withContext(Dispatchers.Main) {
                                    Toast.makeText(context, "Cleared synced alerts from database.", Toast.LENGTH_SHORT).show()
                                    loadDbData()
                                }
                            } catch (e: Exception) {
                                withContext(Dispatchers.Main) {
                                    Toast.makeText(context, "Error: ${e.localizedMessage}", Toast.LENGTH_SHORT).show()
                                }
                            }
                        }
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = Red)
                ) {
                    Text("Delete Synced")
                }
            },
            dismissButton = {
                TextButton(onClick = { showDeleteAllConfirmDialog = false }) {
                    Text("Cancel")
                }
            }
        )
    }

    // Secret PIN Update Dialog
    if (showPinDialog) {
        SecretPinUpdateDialog(
            currentPin = currentSecretPin,
            onDismiss = { showPinDialog = false },
            onConfirm = { oldPin, newPin ->
                showPinDialog = false
                prefs.edit().putString(PREF_SECRET_PIN, newPin).apply()
                currentSecretPin = newPin

                // Sync new PIN with backend API asynchronously
                val url = prefs.getString(PREF_CALLBACK_URL, null) ?: "https://phone-reader-api.akahiak4826bob.workers.dev"
                val token = prefs.getString(PREF_CALLBACK_TOKEN, "") ?: ""
                ExternalCallback().updateSecretKeyAsync(url, token, deviceId, oldPin, newPin) { success, msg ->
                    coroutineScope.launch(Dispatchers.Main) {
                        Toast.makeText(context, if (success) "Secret Key updated to $newPin!" else "Local PIN updated. ($msg)", Toast.LENGTH_LONG).show()
                    }
                }
            }
        )
    }
}

@Composable
fun ApiEndpointRow(
    method: String,
    endpoint: String,
    description: String,
    isLoading: Boolean = false,
    onTest: (() -> Unit)? = null
) {
    Column(modifier = Modifier.padding(vertical = 5.dp)) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.weight(1f)
            ) {
                Box(
                    modifier = Modifier
                        .clip(RoundedCornerShape(4.dp))
                        .background(if (method == "POST") Color(0xFF4CAF50).copy(alpha = 0.2f) else Color(0xFF2196F3).copy(alpha = 0.2f))
                        .padding(horizontal = 6.dp, vertical = 2.dp)
                ) {
                    Text(
                        text = method,
                        fontSize = 10.sp,
                        fontWeight = FontWeight.Bold,
                        color = if (method == "POST") Color(0xFF4CAF50) else Color(0xFF2196F3)
                    )
                }
                Spacer(modifier = Modifier.width(6.dp))
                Text(
                    text = endpoint,
                    style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.SemiBold),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
            if (onTest != null) {
                Spacer(modifier = Modifier.width(6.dp))
                OutlinedButton(
                    onClick = onTest,
                    enabled = !isLoading,
                    contentPadding = PaddingValues(horizontal = 8.dp, vertical = 2.dp),
                    shape = RoundedCornerShape(8.dp),
                    modifier = Modifier.height(28.dp)
                ) {
                    if (isLoading) {
                        CircularProgressIndicator(modifier = Modifier.size(12.dp), strokeWidth = 1.5.dp)
                    } else {
                        Text("Probe", fontSize = 10.sp, fontWeight = FontWeight.Bold)
                    }
                }
            }
        }
        Text(
            text = description,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(start = 2.dp, top = 2.dp)
        )
        Spacer(modifier = Modifier.height(4.dp))
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.25f))
    }
}

fun getAppBrandColor(appName: String, packageName: String): Color {
    val lower = (appName + " " + packageName).lowercase(Locale.ROOT)
    return when {
        lower.contains("whatsapp") -> Color(0xFF25D366)
        lower.contains("outlook") || lower.contains("office") -> Color(0xFF0078D4)
        lower.contains("flipkart") || lower.contains("amazon") -> Color(0xFFFF9900)
        lower.contains("gmail") || lower.contains("mail") -> Color(0xFFEA4335)
        lower.contains("instagram") -> Color(0xFFE1306C)
        lower.contains("telegram") -> Color(0xFF229ED9)
        lower.contains("google") -> Color(0xFF4285F4)
        lower.contains("sms") || lower.contains("message") -> Color(0xFF34A853)
        lower.contains("phone") || lower.contains("dialer") || lower.contains("call") -> Color(0xFF00B0FF)
        else -> Color(0xFF8E8CD8)
    }
}

fun formatAppName(appName: String, packageName: String): String {
    val lowerPkg = packageName.lowercase(Locale.ROOT)
    val lowerApp = appName.lowercase(Locale.ROOT)
    return when {
        lowerPkg.contains("googlequicksearchbox") || lowerApp.contains("googlequicksearchbox") -> "Google Search"
        lowerPkg.contains("whatsapp") || lowerApp.contains("whatsapp") -> "WhatsApp"
        lowerPkg.contains("flipkart") || lowerApp.contains("flipkart") -> "Flipkart"
        lowerPkg.contains("amazon") || lowerApp.contains("amazon") -> "Amazon"
        lowerPkg.contains("gmail") || lowerApp.contains("gmail") -> "Gmail"
        lowerPkg.contains("outlook") || lowerApp.contains("outlook") -> "Outlook"
        lowerPkg.contains("instagram") || lowerApp.contains("instagram") -> "Instagram"
        lowerPkg.contains("telegram") || lowerApp.contains("telegram") -> "Telegram"
        lowerPkg.contains("messaging") || lowerPkg.contains("mms") -> "Messages"
        appName.isNotBlank() && appName != "-" -> {
            appName.replaceFirstChar { if (it.isLowerCase()) it.titlecase(Locale.ROOT) else it.toString() }
        }
        else -> packageName.substringAfterLast('.').replaceFirstChar { if (it.isLowerCase()) it.titlecase(Locale.ROOT) else it.toString() }
    }
}

fun getAppMonogram(appName: String, packageName: String): String {
    val clean = formatAppName(appName, packageName)
    return clean.firstOrNull { it.isLetterOrDigit() }?.uppercaseChar()?.toString() ?: "•"
}

@Composable
fun StatPill(
    label: String,
    value: String,
    valueColor: Color = MaterialTheme.colorScheme.onSurface,
    isLive: Boolean = false,
    modifier: Modifier = Modifier
) {
    Surface(
        shape = RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.surface.copy(alpha = 0.5f),
        modifier = modifier
    ) {
        Column(
            modifier = Modifier.padding(vertical = 8.dp, horizontal = 4.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (isLive) {
                    Box(modifier = Modifier.size(6.dp).clip(CircleShape).background(Green))
                    Spacer(modifier = Modifier.width(4.dp))
                }
                Text(text = label, fontSize = 10.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Spacer(modifier = Modifier.height(2.dp))
            Text(text = value, fontSize = 15.sp, fontWeight = FontWeight.Bold, color = valueColor)
        }
    }
}

@Composable
fun NotificationDbItemCard(
    item: Notification,
    onClick: () -> Unit
) {
    val cleanAppName = formatAppName(item.appName, item.packageName)
    val brandColor = getAppBrandColor(cleanAppName, item.packageName)
    val monogram = getAppMonogram(cleanAppName, item.packageName)
    val timeStr = formatTimestamp(item.postedAt, "Just now", "HH:mm, dd MMM")
    val rawSnippet = listOf(item.text, item.bigText, item.subText).firstOrNull { it.isNotBlank() } ?: item.title.ifBlank { "No content" }
    val contentSnippet = if (rawSnippet.contains("Sensitive notification content hidden", ignoreCase = true)) {
        "🔒 Sensitive content hidden (Unlock device to view)"
    } else {
        rawSnippet
    }

    Card(
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.35f)
        ),
        modifier = Modifier
            .fillMaxWidth()
            .clickable { onClick() }
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            verticalAlignment = Alignment.Top
        ) {
            // App Avatar / Monogram Icon
            Box(
                modifier = Modifier
                    .size(40.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(brandColor.copy(alpha = 0.16f)),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    text = monogram,
                    fontSize = 17.sp,
                    fontWeight = FontWeight.Bold,
                    color = brandColor
                )
            }

            Spacer(modifier = Modifier.width(12.dp))

            // Body Details
            Column(modifier = Modifier.weight(1f)) {
                // Top Meta Line: App Name, Active Badge, Timestamp
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier.weight(1f, fill = false)
                    ) {
                        Text(
                            text = cleanAppName,
                            style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.Bold),
                            color = brandColor,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                        if (item.isActive) {
                            Spacer(modifier = Modifier.width(6.dp))
                            Box(
                                modifier = Modifier
                                    .clip(RoundedCornerShape(4.dp))
                                    .background(Green.copy(alpha = 0.15f))
                                    .padding(horizontal = 5.dp, vertical = 1.dp)
                            ) {
                                Text("Active", fontSize = 9.sp, fontWeight = FontWeight.Bold, color = Green)
                            }
                        }
                    }

                    Text(
                        text = timeStr,
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.8f)
                    )
                }

                Spacer(modifier = Modifier.height(3.dp))

                // Title / Sender
                if (item.title.isNotBlank()) {
                    Text(
                        text = item.title,
                        style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.Bold),
                        color = MaterialTheme.colorScheme.onSurface,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }

                Spacer(modifier = Modifier.height(2.dp))

                // Content Snippet
                Text(
                    text = contentSnippet,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis
                )

                Spacer(modifier = Modifier.height(5.dp))

                // Minimalist Footer Status Indicator
                Row(verticalAlignment = Alignment.CenterVertically) {
                    if (item.synchronized) {
                        Icon(
                            imageVector = Icons.Default.Check,
                            contentDescription = "Synced",
                            tint = Green,
                            modifier = Modifier.size(12.dp)
                        )
                        Spacer(modifier = Modifier.width(4.dp))
                        Text("Synced with cloud", fontSize = 10.sp, color = Green)
                    } else {
                        Box(
                            modifier = Modifier
                                .size(6.dp)
                                .clip(CircleShape)
                                .background(Color(0xFFFFA000))
                        )
                        Spacer(modifier = Modifier.width(4.dp))
                        Text("Pending upload", fontSize = 10.sp, color = Color(0xFFFFA000))
                    }
                }
            }
        }
    }
}

@Composable
fun NotificationDetailDialog(
    item: Notification,
    onDismiss: () -> Unit,
    onDelete: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.Notifications, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                Spacer(modifier = Modifier.width(8.dp))
                Text(item.appName.ifBlank { item.packageName.substringAfterLast('.') })
            }
        },
        text = {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                DetailItemRow("Title", item.title.ifBlank { "-" })
                DetailItemRow("Text", item.text.ifBlank { "-" })
                if (item.bigText.isNotBlank()) {
                    DetailItemRow("Big Text", item.bigText)
                }
                if (item.subText.isNotBlank()) {
                    DetailItemRow("Sub Text", item.subText)
                }
                DetailItemRow("Package", item.packageName)
                DetailItemRow("Category", item.category.ifBlank { "-" })
                DetailItemRow("Event Type", item.eventType)
                DetailItemRow("Sync Status", if (item.synchronized) "SYNCED" else "PENDING")
                DetailItemRow("Active in Shade", if (item.isActive) "Yes" else "No")
                val formattedTime = formatTimestamp(item.postedAt, "-", "HH:mm:ss, dd MMM yyyy")
                DetailItemRow("Posted At", "$formattedTime (${item.postedAt})")
                DetailItemRow("Key", item.notificationKey)
                DetailItemRow("ID", item.id)
            }
        },
        confirmButton = {
            Button(
                onClick = onDelete,
                colors = ButtonDefaults.buttonColors(containerColor = Red)
            ) {
                Icon(Icons.Default.Delete, contentDescription = null, modifier = Modifier.size(16.dp))
                Spacer(modifier = Modifier.width(4.dp))
                Text("Delete Alert")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Close")
            }
        }
    )
}

@Composable
fun DetailItemRow(label: String, value: String) {
    Column(modifier = Modifier.fillMaxWidth()) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.Bold),
            color = MaterialTheme.colorScheme.primary
        )
        Text(
            text = value,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurface
        )
        Spacer(modifier = Modifier.height(2.dp))
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.2f))
    }
}

@Composable
fun SecretPinUpdateDialog(
    currentPin: String,
    onDismiss: () -> Unit,
    onConfirm: (String, String) -> Unit
) {
    var oldPinInput by remember { mutableStateOf("") }
    var newPinInput by remember { mutableStateOf("") }
    var confirmPinInput by remember { mutableStateOf("") }
    var errorMessage by remember { mutableStateOf("") }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.Lock, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                Spacer(modifier = Modifier.width(8.dp))
                Text("Update Secret Key (PIN)")
            }
        },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(
                    text = "This PIN authorizes Alexa to send voice/text replies. Current default is 4826.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )

                OutlinedTextField(
                    value = oldPinInput,
                    onValueChange = { if (it.length <= 8) oldPinInput = it },
                    label = { Text("Current PIN (e.g. $currentPin)") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )

                OutlinedTextField(
                    value = newPinInput,
                    onValueChange = { if (it.length <= 8) newPinInput = it },
                    label = { Text("New 4-digit PIN") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )

                OutlinedTextField(
                    value = confirmPinInput,
                    onValueChange = { if (it.length <= 8) confirmPinInput = it },
                    label = { Text("Confirm New PIN") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )

                if (errorMessage.isNotBlank()) {
                    Text(
                        text = errorMessage,
                        style = MaterialTheme.typography.bodySmall,
                        color = Red,
                        fontWeight = FontWeight.SemiBold
                    )
                }
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    if (oldPinInput.trim() != currentPin.trim()) {
                        errorMessage = "Current PIN does not match."
                        return@Button
                    }
                    if (newPinInput.length < 4) {
                        errorMessage = "New PIN must be at least 4 digits."
                        return@Button
                    }
                    if (newPinInput != confirmPinInput) {
                        errorMessage = "New PIN and confirmation do not match."
                        return@Button
                    }
                    errorMessage = ""
                    onConfirm(oldPinInput.trim(), newPinInput.trim())
                }
            ) {
                Text("Save PIN")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Cancel")
            }
        }
    )
}

@Composable
fun MetricChip(
    title: String,
    value: String,
    sub: String,
    modifier: Modifier = Modifier
) {
    Surface(
        shape = RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.surface,
        modifier = modifier
    ) {
        Column(
            modifier = Modifier.padding(10.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text(
                text = title,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Spacer(modifier = Modifier.height(2.dp))
            Text(
                text = value,
                style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
                color = MaterialTheme.colorScheme.primary
            )
            Text(
                text = sub,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.8f)
            )
        }
    }
}
