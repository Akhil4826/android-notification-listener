package ee.kytt.androidnotificationlistener.service

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import ee.kytt.androidnotificationlistener.Constants.PREFS_NAME
import ee.kytt.androidnotificationlistener.Constants.PREF_ACTIVE_NOTIFICATIONS_COUNT
import ee.kytt.androidnotificationlistener.Constants.PREF_CALLBACK_TOKEN
import ee.kytt.androidnotificationlistener.Constants.PREF_CALLBACK_URL
import ee.kytt.androidnotificationlistener.Constants.PREF_DEVICE_ID
import ee.kytt.androidnotificationlistener.Constants.PREF_FAIL_COUNT
import ee.kytt.androidnotificationlistener.Constants.PREF_LAST_ACTIVE_SYNC_TIME
import ee.kytt.androidnotificationlistener.Constants.PREF_LAST_SUCCESS_TIME
import ee.kytt.androidnotificationlistener.Constants.PREF_LATEST_ATTEMPT_TIME
import ee.kytt.androidnotificationlistener.Constants.PREF_LATEST_PACKAGE_NAME
import ee.kytt.androidnotificationlistener.Constants.PREF_LATEST_STATUS
import ee.kytt.androidnotificationlistener.Constants.PREF_LATEST_SYNC_ERROR
import ee.kytt.androidnotificationlistener.Constants.PREF_LATEST_TITLE
import ee.kytt.androidnotificationlistener.Constants.PREF_PACKAGE_PATTERN
import ee.kytt.androidnotificationlistener.R
import ee.kytt.androidnotificationlistener.data.Notification
import ee.kytt.androidnotificationlistener.data.NotificationSyncPayload
import ee.kytt.androidnotificationlistener.data.SyncResult
import ee.kytt.androidnotificationlistener.persistence.NotificationDatabase
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

class NotificationListener : NotificationListenerService() {

    companion object {
        private const val TAG = "NotificationListener"
        private const val DEDUPE_WINDOW_MS = 3000L

        @Volatile
        var instance: NotificationListener? = null
            private set

        fun isConnected(): Boolean = instance != null

        fun isWebSocketConnected(): Boolean = instance?.callbackService?.isWebSocketConnected ?: false

        fun getOrCreateDeviceId(context: Context): String {
            val prefs = context.getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
            var deviceId = prefs.getString(PREF_DEVICE_ID, null)
            if (deviceId.isNullOrEmpty()) {
                deviceId = UUID.randomUUID().toString()
                prefs.edit().putString(PREF_DEVICE_ID, deviceId).apply()
            }
            return deviceId
        }
    }

    private val callbackService = ExternalCallback()
    private val recentNotifications = ConcurrentHashMap<String, Pair<String, Long>>()
    private val replyableActions = ConcurrentHashMap<String, android.app.Notification.Action>()
    private val executedActionIds = java.util.Collections.newSetFromMap(ConcurrentHashMap<String, Boolean>())
    private var activeRingtone: android.media.Ringtone? = null
    private var actionPollingJob: Job? = null
    private var networkCallback: ConnectivityManager.NetworkCallback? = null
    private var lastStatusReportTime = 0L
    private var lastReportedBattery = -1

    override fun onListenerConnected() {
        super.onListenerConnected()
        instance = this
        Log.i(TAG, "NotificationListener connected. Initializing active notification synchronization.")
        syncActiveNotifications()
        checkAndReportStatusAndActions()

        // Connect real-time WebSocket for instantaneous push actions (< 100ms)
        val deviceId = getOrCreateDeviceId(applicationContext)
        callbackService.startActionWebSocket(deviceId) { actionMap ->
            Log.i(TAG, "Received action via real-time WebSocket: ${actionMap["actionType"]}")
            handleDeviceAction(actionMap)
        }

        // Register modern network callback to instantly reconnect on Wi-Fi/cellular transitions
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
        if (networkCallback == null && cm != null) {
            val callback = object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: Network) {
                    Log.i(TAG, "Network became available. Ensuring real-time WebSocket connection and active sync.")
                    val devId = getOrCreateDeviceId(applicationContext)
                    callbackService.startActionWebSocket(devId) { actionMap ->
                        handleDeviceAction(actionMap)
                    }
                    syncActiveNotifications()
                    checkAndReportStatusAndActions()
                }
            }
            try {
                cm.registerDefaultNetworkCallback(callback)
                networkCallback = callback
            } catch (e: Exception) {
                Log.w(TAG, "Failed registering NetworkCallback", e)
            }
        }

        // Background heartbeat ticker (runs every 5 minutes as gentle fallback)
        actionPollingJob?.cancel()
        actionPollingJob = CoroutineScope(Dispatchers.IO).launch {
            while (isActive) {
                try {
                    checkAndReportStatusAndActions()
                } catch (e: Exception) {
                    Log.w(TAG, "Error in action polling ticker", e)
                }
                delay(300000L) // 5 minutes gentle fallback safety net
            }
        }
    }

    override fun onListenerDisconnected() {
        super.onListenerDisconnected()
        actionPollingJob?.cancel()
        actionPollingJob = null
        callbackService.stopActionWebSocket()
        networkCallback?.let {
            val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
            try { cm?.unregisterNetworkCallback(it) } catch (e: Exception) {}
            networkCallback = null
        }
        if (instance == this) {
            instance = null
        }
        stopPhoneRinger()
        Log.i(TAG, "NotificationListener disconnected.")
    }

    override fun onDestroy() {
        actionPollingJob?.cancel()
        actionPollingJob = null
        callbackService.stopActionWebSocket()
        networkCallback?.let {
            val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
            try { cm?.unregisterNetworkCallback(it) } catch (e: Exception) {}
            networkCallback = null
        }
        super.onDestroy()
    }

    /**
     * Executes Direct Reply to a notification using Android RemoteInput.
     */
    fun executeDirectReply(
        notificationKey: String,
        targetSender: String,
        targetApp: String,
        text: String
    ): Boolean {
        Log.i(TAG, "executeDirectReply: key='$notificationKey', sender='$targetSender', app='$targetApp', text='$text'")

        // 1. Try finding in cached replyableActions by exact key
        var targetAction = replyableActions[notificationKey]

        // 2. Fallback to sender matching in cache (ignoring generic words)
        val cleanSender = targetSender.replace(Regex("^(?:your contact|them|him|her)$", RegexOption.IGNORE_CASE), "").trim()
        if (targetAction == null && cleanSender.isNotEmpty()) {
            val matchedEntry = replyableActions.entries.firstOrNull { (k, _) ->
                k.contains(cleanSender, ignoreCase = true) || cleanSender.contains(k, ignoreCase = true)
            }
            targetAction = matchedEntry?.value
        }

        // 3. Fallback: inspect live notifications currently in the status bar
        if (targetAction == null) {
            val activeSbns = try { getActiveNotifications() ?: emptyArray() } catch (e: Exception) { emptyArray() }
            val sortedSbns = activeSbns.sortedByDescending { it.postTime }

            // Priority A: Exact key match
            var matchedSbn = sortedSbns.firstOrNull { it.key == notificationKey }

            // Priority B: Match by target sender in title, extras, or text
            if (matchedSbn == null && cleanSender.isNotEmpty()) {
                matchedSbn = sortedSbns.firstOrNull { sbn ->
                    val title = sbn.notification.extras?.getCharSequence(android.app.Notification.EXTRA_TITLE)?.toString() ?: ""
                    val extraText = sbn.notification.extras?.getCharSequence(android.app.Notification.EXTRA_TEXT)?.toString() ?: ""
                    val subText = sbn.notification.extras?.getCharSequence(android.app.Notification.EXTRA_SUB_TEXT)?.toString() ?: ""
                    title.contains(cleanSender, ignoreCase = true) ||
                    cleanSender.contains(title, ignoreCase = true) ||
                    extraText.contains(cleanSender, ignoreCase = true) ||
                    subText.contains(cleanSender, ignoreCase = true)
                }
            }

            // Priority C: Match by target app (Instagram, WhatsApp, Telegram, Signal, Messages)
            if (matchedSbn == null && targetApp.isNotBlank()) {
                val appClean = targetApp.lowercase().trim()
                matchedSbn = sortedSbns.firstOrNull { sbn ->
                    val pkg = sbn.packageName.lowercase()
                    val hasReply = sbn.notification.actions?.any { it.remoteInputs != null && it.remoteInputs.isNotEmpty() } == true
                    hasReply && when {
                        appClean.contains("instagram") -> pkg.contains("instagram")
                        appClean.contains("whatsapp") -> pkg.contains("whatsapp")
                        appClean.contains("telegram") -> pkg.contains("telegram")
                        appClean.contains("signal") -> pkg.contains("signal")
                        appClean.contains("message") || appClean.contains("sms") -> pkg.contains("messaging") || pkg.contains("mms") || pkg.contains("telephony")
                        else -> pkg.contains(appClean)
                    }
                }
            }

            // Priority D: Fallback to the newest active notification on device with a RemoteInput action
            if (matchedSbn == null) {
                matchedSbn = sortedSbns.firstOrNull { sbn ->
                    sbn.notification.actions?.any { it.remoteInputs != null && it.remoteInputs.isNotEmpty() } == true
                }
            }

            if (matchedSbn != null) {
                targetAction = matchedSbn.notification.actions?.firstOrNull { act ->
                    act.remoteInputs != null && act.remoteInputs.isNotEmpty()
                }
                if (targetAction != null) {
                    replyableActions[matchedSbn.key] = targetAction
                }
            }
        }

        if (targetAction == null) {
            Log.w(TAG, "No replyable RemoteInput action found for key: $notificationKey, sender: $targetSender, app: $targetApp")
            return false
        }

        val remoteInputs = targetAction.remoteInputs
        if (remoteInputs.isNullOrEmpty()) {
            return false
        }

        val intent = android.content.Intent()
        val bundle = android.os.Bundle()
        for (remoteInput in remoteInputs) {
            bundle.putCharSequence(remoteInput.resultKey, text)
        }
        android.app.RemoteInput.addResultsToIntent(remoteInputs, intent, bundle)

        return try {
            targetAction.actionIntent.send(applicationContext, 0, intent)
            Log.i(TAG, "Direct reply successfully sent via RemoteInput: $text")
            true
        } catch (e: Exception) {
            Log.e(TAG, "Failed sending Direct Reply PendingIntent", e)
            false
        }
    }

    fun executeDirectReply(notificationKey: String, targetSender: String, text: String): Boolean {
        return executeDirectReply(notificationKey, targetSender, "", text)
    }

    /**
     * Dismiss a notification from the physical phone.
     */
    fun dismissNotificationByKey(key: String): Boolean {
        return try {
            if (key.isEmpty() || key.equals("ALL", ignoreCase = true)) {
                cancelAllNotifications()
            } else {
                cancelNotification(key)
            }
            true
        } catch (e: Exception) {
            Log.w(TAG, "Failed to cancel notification: $key", e)
            false
        }
    }

    /**
     * Ring phone at max volume for Find My Phone feature.
     */
    fun startPhoneRinger() {
        try {
            val audioManager = getSystemService(Context.AUDIO_SERVICE) as? android.media.AudioManager
            audioManager?.setStreamVolume(
                android.media.AudioManager.STREAM_ALARM,
                audioManager.getStreamMaxVolume(android.media.AudioManager.STREAM_ALARM),
                0
            )

            val alertUri = android.media.RingtoneManager.getDefaultUri(android.media.RingtoneManager.TYPE_ALARM)
                ?: android.media.RingtoneManager.getDefaultUri(android.media.RingtoneManager.TYPE_RINGTONE)

            stopPhoneRinger()
            activeRingtone = android.media.RingtoneManager.getRingtone(applicationContext, alertUri)
            activeRingtone?.play()
            Log.i(TAG, "Find My Phone ringer started at maximum volume.")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start phone ringer", e)
        }
    }

    fun stopPhoneRinger() {
        try {
            activeRingtone?.stop()
            activeRingtone = null
            Log.i(TAG, "Find My Phone ringer stopped.")
        } catch (e: Exception) {}
    }

    /**
     * Report battery status to Cloudflare Edge if changed or threshold elapsed.
     */
    fun reportBatteryStatusIfNeeded() {
        val context = applicationContext
        val prefs = context.getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
        val url = prefs.getString(PREF_CALLBACK_URL, null) ?: return
        val token = prefs.getString(PREF_CALLBACK_TOKEN, null) ?: ""
        val deviceId = getOrCreateDeviceId(context)

        try {
            val batteryIntent = context.registerReceiver(null, android.content.IntentFilter(android.content.Intent.ACTION_BATTERY_CHANGED))
            val level = batteryIntent?.getIntExtra(android.os.BatteryManager.EXTRA_LEVEL, -1) ?: 100
            val scale = batteryIntent?.getIntExtra(android.os.BatteryManager.EXTRA_SCALE, -1) ?: 100
            val batteryPct = if (level >= 0 && scale > 0) ((level.toFloat() / scale.toFloat()) * 100).toInt() else 100

            val status = batteryIntent?.getIntExtra(android.os.BatteryManager.EXTRA_STATUS, -1) ?: -1
            val isCharging = status == android.os.BatteryManager.BATTERY_STATUS_CHARGING || status == android.os.BatteryManager.BATTERY_STATUS_FULL

            val chargePlug = batteryIntent?.getIntExtra(android.os.BatteryManager.EXTRA_PLUGGED, -1) ?: -1
            val chargingType = when (chargePlug) {
                android.os.BatteryManager.BATTERY_PLUGGED_AC -> "AC"
                android.os.BatteryManager.BATTERY_PLUGGED_USB -> "USB"
                android.os.BatteryManager.BATTERY_PLUGGED_WIRELESS -> "WIRELESS"
                else -> "NONE"
            }

            val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as? android.media.AudioManager
            val ringerMode = when (audioManager?.ringerMode) {
                android.media.AudioManager.RINGER_MODE_SILENT -> "SILENT"
                android.media.AudioManager.RINGER_MODE_VIBRATE -> "VIBRATE"
                else -> "NORMAL"
            }

            val now = System.currentTimeMillis()
            if (batteryPct != lastReportedBattery || (now - lastStatusReportTime) > 60000L) {
                lastReportedBattery = batteryPct
                lastStatusReportTime = now
                callbackService.sendDeviceStatus(url, token, deviceId, batteryPct, isCharging, chargingType, ringerMode)
            }
        } catch (e: Exception) {
            Log.w(TAG, "Could not read battery", e)
        }
    }

    /**
     * Report battery status and poll pending actions from Cloudflare Edge as fallback.
     */
    fun checkAndReportStatusAndActions() {
        reportBatteryStatusIfNeeded()

        val context = applicationContext
        val prefs = context.getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
        val url = prefs.getString(PREF_CALLBACK_URL, null) ?: return
        val token = prefs.getString(PREF_CALLBACK_TOKEN, null) ?: ""
        val deviceId = getOrCreateDeviceId(context)

        // Poll pending device actions ONLY as gentle fallback if real-time WebSocket is not connected
        if (!callbackService.isWebSocketConnected) {
            callbackService.fetchPendingActions(url, token, deviceId) { actions ->
                for ((_, actionMap) in actions) {
                    handleDeviceAction(actionMap)
                }
            }
        }
    }

    /**
     * Executes incoming device actions (REPLY, DISMISS, RING_PHONE, STOP_RING)
     * triggered via real-time WebSocket push or periodic fallback sync.
     */
    fun handleDeviceAction(actionMap: Map<String, String>) {
        val actionId = actionMap["id"] ?: ""
        val actionType = actionMap["actionType"] ?: return

        // Strict idempotency / deduplication: never execute the same actionId twice
        if (actionId.isNotEmpty()) {
            if (!executedActionIds.add(actionId)) {
                Log.d(TAG, "Action $actionId already processed or executing. Skipping duplicate execution.")
                return
            }
            if (executedActionIds.size > 500) {
                executedActionIds.clear()
                executedActionIds.add(actionId)
            }
        }

        var success = false
        var error = ""

        when (actionType) {
            "REPLY" -> {
                val key = actionMap["targetKey"] ?: ""
                val sender = actionMap["targetSender"] ?: ""
                val app = actionMap["targetApp"] ?: ""
                val replyText = actionMap["payload"] ?: ""
                success = executeDirectReply(key, sender, app, replyText)
                if (!success) error = "No active notification with direct reply found on phone"
            }
            "DISMISS" -> {
                val key = actionMap["targetKey"] ?: ""
                success = dismissNotificationByKey(key)
            }
            "RING_PHONE" -> {
                startPhoneRinger()
                success = true
            }
            "STOP_RING" -> {
                stopPhoneRinger()
                success = true
            }
        }

        if (actionId.isNotEmpty()) {
            val context = applicationContext
            val prefs = context.getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
            val url = prefs.getString(PREF_CALLBACK_URL, null) ?: return
            val token = prefs.getString(PREF_CALLBACK_TOKEN, null) ?: ""
            val deviceId = getOrCreateDeviceId(context)
            callbackService.completeAction(url, token, deviceId, actionId, success, error)
        }
    }


    override fun onNotificationPosted(sbn: StatusBarNotification) {
        val context = applicationContext
        val prefs = context.getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
        val packagePattern = prefs.getString(PREF_PACKAGE_PATTERN, null) ?: ""

        if (!shouldMatch(packagePattern, sbn.packageName)) {
            Log.d(TAG, "Ignoring notification from package: ${sbn.packageName} (filtered)")
            return
        }

        if (Notification.isIgnorableEmptySummary(sbn)) {
            Log.d(TAG, "Ignoring phantom empty group summary or empty notification: ${sbn.packageName} (${sbn.key})")
            return
        }

        val deviceId = getOrCreateDeviceId(context)
        val notification = Notification(
            sbn = sbn,
            context = context,
            deviceId = deviceId,
            eventType = "POSTED",
            isActive = true
        )

        // Deduplication: check if exact same key and content was received within DEDUPE_WINDOW_MS
        val contentSignature = "${notification.title}|${notification.text}|${notification.bigText}"
        val now = System.currentTimeMillis()
        val previous = recentNotifications[sbn.key]
        if (previous != null && previous.first == contentSignature && (now - previous.second) < DEDUPE_WINDOW_MS) {
            Log.d(TAG, "Deduplicating notification update for key: ${sbn.key}")
            return
        }
        recentNotifications[sbn.key] = Pair(contentSignature, now)

        Log.d(TAG, "Notification posted: ${notification.appName} (${notification.packageName}): ${notification.title}")

        val url = prefs.getString(PREF_CALLBACK_URL, null)
        val token = prefs.getString(PREF_CALLBACK_TOKEN, null) ?: ""
        val notSetText = context.getString(R.string.callback_url_not_set)

        if (url.isNullOrEmpty()) {
            Log.w(TAG, "No callback URL set")
            saveFailedNotification(notification, context, SyncResult(false, "Failed", notSetText))
            return
        }

        // Cache replyable RemoteInput actions for direct voice reply (WhatsApp, Instagram, etc.)
        sbn.notification.actions?.forEach { act ->
            if (act.remoteInputs != null && act.remoteInputs.isNotEmpty()) {
                replyableActions[sbn.key] = act
                if (notification.title.isNotBlank()) {
                    replyableActions[notification.title] = act
                }
            }
        }

        // Opportunistically report battery if needed (never poll actions on notification post)
        reportBatteryStatusIfNeeded()

        callbackService.sendAsync(url, token, notification, deviceId) { result ->
            if (!result.success) {
                saveFailedNotification(notification, context, result)
            } else {
                saveSyncedNotification(notification, context)
                prefs.edit().apply {
                    putString(PREF_LATEST_TITLE, notification.description())
                    putString(PREF_LATEST_PACKAGE_NAME, notification.appName.ifEmpty { notification.packageName })
                    putString(PREF_LATEST_STATUS, result.status)
                    putString(PREF_LATEST_SYNC_ERROR, result.userMessage)
                    putLong(PREF_LATEST_ATTEMPT_TIME, System.currentTimeMillis())
                    putLong(PREF_LAST_SUCCESS_TIME, System.currentTimeMillis())
                    apply()
                }
            }
            updateActiveCountPreference()
        }
    }

    override fun onNotificationRemoved(sbn: StatusBarNotification) {
        val context = applicationContext
        val prefs = context.getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
        val packagePattern = prefs.getString(PREF_PACKAGE_PATTERN, null) ?: ""

        if (!shouldMatch(packagePattern, sbn.packageName)) {
            return
        }

        recentNotifications.remove(sbn.key)
        replyableActions.remove(sbn.key)


        val deviceId = getOrCreateDeviceId(context)
        val notification = Notification(
            sbn = sbn,
            context = context,
            deviceId = deviceId,
            eventType = "REMOVED",
            isActive = false
        )

        Log.d(TAG, "Notification removed: ${notification.appName} (${sbn.key})")

        // Mark inactive in local database
        CoroutineScope(Dispatchers.IO).launch {
            val db = NotificationDatabase.getDatabase(context)
            db.notificationDao().markInactiveByKey(sbn.key, System.currentTimeMillis())
        }

        val url = prefs.getString(PREF_CALLBACK_URL, null)
        val token = prefs.getString(PREF_CALLBACK_TOKEN, null) ?: ""

        if (!url.isNullOrEmpty()) {
            callbackService.sendAsync(url, token, notification, deviceId) { result ->
                if (!result.success) {
                    saveFailedNotification(notification, context, result)
                }
                updateActiveCountPreference()
            }
        } else {
            updateActiveCountPreference()
        }
    }

    /**
     * Synchronises currently active notifications from the Android notification bar.
     */
    fun syncActiveNotifications(onComplete: ((Boolean, String) -> Unit)? = null) {
        val context = applicationContext
        val prefs = context.getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
        val packagePattern = prefs.getString(PREF_PACKAGE_PATTERN, null) ?: ""
        val url = prefs.getString(PREF_CALLBACK_URL, null)
        val token = prefs.getString(PREF_CALLBACK_TOKEN, null) ?: ""
        val deviceId = getOrCreateDeviceId(context)

        CoroutineScope(Dispatchers.IO).launch {
            try {
                val activeSbns = try {
                    getActiveNotifications() ?: emptyArray()
                } catch (e: Exception) {
                    Log.e(TAG, "Failed to call getActiveNotifications()", e)
                    emptyArray()
                }

                // Cache replyable RemoteInput actions from all active notifications
                activeSbns.forEach { sbn ->
                    sbn.notification.actions?.forEach { act ->
                        if (act.remoteInputs != null && act.remoteInputs.isNotEmpty()) {
                            replyableActions[sbn.key] = act
                            val title = sbn.notification.extras?.getCharSequence(android.app.Notification.EXTRA_TITLE)?.toString() ?: ""
                            if (title.isNotBlank()) {
                                replyableActions[title] = act
                            }
                        }
                    }
                }

                val activeList = activeSbns
                    .filter { shouldMatch(packagePattern, it.packageName) }
                    .filter { !Notification.isIgnorableEmptySummary(it) }
                    .map { sbn ->
                        Notification(
                            sbn = sbn,
                            context = context,
                            deviceId = deviceId,
                            eventType = "SYNC_ACTIVE",
                            isActive = true
                        )
                    }

                val db = NotificationDatabase.getDatabase(context)
                val dao = db.notificationDao()
                val activeKeys = activeList.map { it.notificationKey }

                // Mark any DB notifications that are no longer active on the device as inactive
                if (activeKeys.isNotEmpty()) {
                    dao.markAllInactiveExcept(activeKeys, System.currentTimeMillis())
                    dao.insertAll(activeList)
                } else {
                    dao.markAllInactiveExcept(emptyList(), System.currentTimeMillis())
                }

                prefs.edit().apply {
                    putInt(PREF_ACTIVE_NOTIFICATIONS_COUNT, activeList.size)
                    putLong(PREF_LAST_ACTIVE_SYNC_TIME, System.currentTimeMillis())
                    apply()
                }

                if (url.isNullOrEmpty()) {
                    onComplete?.invoke(false, context.getString(R.string.callback_url_not_set))
                    return@launch
                }

                val payload = NotificationSyncPayload(
                    deviceId = deviceId,
                    isFullActiveSync = true,
                    notifications = activeList
                )

                callbackService.sendBatchAsync(url, token, payload, deviceId) { result ->
                    if (result.success) {
                        CoroutineScope(Dispatchers.IO).launch {
                            dao.markAllSynced(activeList.map { it.id })
                        }
                        prefs.edit().apply {
                            putString(PREF_LATEST_STATUS, result.status)
                            putLong(PREF_LAST_SUCCESS_TIME, System.currentTimeMillis())
                            putLong(PREF_LATEST_ATTEMPT_TIME, System.currentTimeMillis())
                            apply()
                        }
                        onComplete?.invoke(true, "Synchronized ${activeList.size} active notifications.")
                    } else {
                        prefs.edit().apply {
                            putString(PREF_LATEST_STATUS, result.status)
                            putString(PREF_LATEST_SYNC_ERROR, result.userMessage)
                            putLong(PREF_LATEST_ATTEMPT_TIME, System.currentTimeMillis())
                            apply()
                        }
                        onComplete?.invoke(false, result.userMessage)
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error during active notification synchronization", e)
                onComplete?.invoke(false, e.localizedMessage ?: "Sync error")
            }
        }
    }

    private fun updateActiveCountPreference() {
        val context = applicationContext
        try {
            val count = getActiveNotifications()?.size ?: 0
            context.getSharedPreferences(PREFS_NAME, MODE_PRIVATE).edit().apply {
                putInt(PREF_ACTIVE_NOTIFICATIONS_COUNT, count)
                apply()
            }
        } catch (e: Exception) {
            Log.w(TAG, "Could not query active notifications count", e)
        }
    }

    private fun saveFailedNotification(notification: Notification, context: Context, result: SyncResult) {
        CoroutineScope(Dispatchers.IO).launch {
            val db = NotificationDatabase.getDatabase(context)
            db.notificationDao().insert(notification.copy(synchronized = false, syncStatus = "FAILED"))
            val failed = db.notificationDao().countFailed()

            Log.d(TAG, "Saved failed notification to local DB, unsynced count: $failed")

            context.getSharedPreferences(PREFS_NAME, MODE_PRIVATE).edit().apply {
                putInt(PREF_FAIL_COUNT, failed)
                putString(PREF_LATEST_STATUS, result.status)
                putString(PREF_LATEST_SYNC_ERROR, result.userMessage)
                putLong(PREF_LATEST_ATTEMPT_TIME, System.currentTimeMillis())
                apply()
            }
        }
    }

    private fun saveSyncedNotification(notification: Notification, context: Context) {
        CoroutineScope(Dispatchers.IO).launch {
            val db = NotificationDatabase.getDatabase(context)
            db.notificationDao().insert(notification.copy(synchronized = true, syncStatus = "SYNCED"))
        }
    }

    private fun shouldMatch(packagePattern: String, name: String): Boolean {
        if (packagePattern.isBlank()) {
            return true
        }
        return try {
            Regex(packagePattern).containsMatchIn(name)
        } catch (e: Exception) {
            Log.w(TAG, "Invalid regex pattern: $packagePattern", e)
            false
        }
    }

}
