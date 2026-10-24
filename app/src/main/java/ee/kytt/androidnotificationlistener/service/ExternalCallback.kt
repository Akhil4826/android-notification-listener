package ee.kytt.androidnotificationlistener.service

import android.util.Log
import ee.kytt.androidnotificationlistener.data.Notification
import ee.kytt.androidnotificationlistener.data.NotificationSyncPayload
import ee.kytt.androidnotificationlistener.data.SyncResult
import kotlinx.serialization.json.Json
import okhttp3.Call
import okhttp3.Callback
import okhttp3.ConnectionPool
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.io.IOException
import java.util.concurrent.TimeUnit

class ExternalCallback {

    private val jsonSerializer = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
    }

    private val client = OkHttpClient.Builder()
        .connectionPool(ConnectionPool(8, 5, TimeUnit.MINUTES))
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .writeTimeout(10, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build()

    fun sendAsync(
        url: String,
        token: String,
        notification: Notification,
        deviceId: String = "",
        callback: (SyncResult) -> Unit
    ) {
        val request: Request

        try {
            request = createRequest(url, token, notification, deviceId)
        } catch (e: Exception) {
            Log.w("ExternalCallback", "Failed to create request", e)
            callback(SyncResult(e))
            return
        }

        client.newCall(request).enqueue(object : Callback {
            override fun onResponse(call: Call, response: Response) {
                response.use {
                    Log.d("ExternalCallback", "Response: ${response.code}")
                    callback(SyncResult(response))
                }
            }

            override fun onFailure(call: Call, e: IOException) {
                Log.e("ExternalCallback", "Failed to post notification", e)
                callback(SyncResult(e))
            }
        })
    }

    fun sendSync(
        url: String,
        token: String,
        notification: Notification,
        deviceId: String = ""
    ): SyncResult {
        try {
            val request = createRequest(url, token, notification, deviceId)
            client.newCall(request).execute().use { response ->
                Log.d("ExternalCallback", "Response: ${response.code}")
                return SyncResult(response)
            }
        } catch (e: Exception) {
            Log.w("ExternalCallback", "Failed to post notification", e)
            return SyncResult(e)
        }
    }

    fun sendBatchSync(
        url: String,
        token: String,
        payload: NotificationSyncPayload,
        deviceId: String = ""
    ): SyncResult {
        try {
            val request = createBatchRequest(url, token, payload, deviceId)
            client.newCall(request).execute().use { response ->
                Log.d("ExternalCallback", "Batch response: ${response.code}")
                return SyncResult(response)
            }
        } catch (e: Exception) {
            Log.w("ExternalCallback", "Failed to send batch", e)
            return SyncResult(e)
        }
    }

    fun sendBatchAsync(
        url: String,
        token: String,
        payload: NotificationSyncPayload,
        deviceId: String = "",
        callback: (SyncResult) -> Unit
    ) {
        val request: Request
        try {
            request = createBatchRequest(url, token, payload, deviceId)
        } catch (e: Exception) {
            Log.w("ExternalCallback", "Failed to create batch request", e)
            callback(SyncResult(e))
            return
        }

        client.newCall(request).enqueue(object : Callback {
            override fun onResponse(call: Call, response: Response) {
                response.use {
                    Log.d("ExternalCallback", "Batch response: ${response.code}")
                    callback(SyncResult(response))
                }
            }

            override fun onFailure(call: Call, e: IOException) {
                Log.e("ExternalCallback", "Failed to send batch", e)
                callback(SyncResult(e))
            }
        })
    }

    private fun createRequest(
        url: String,
        token: String,
        notification: Notification,
        deviceId: String
    ): Request {
        val json = jsonSerializer.encodeToString(notification)
        val mediaType = "application/json; charset=utf-8".toMediaType()
        val body = json.toRequestBody(mediaType)

        val builder = Request.Builder()
            .url(url)
            .post(body)
            .addHeader("User-Agent", "AndroidNotificationListener/1.0")

        if (token.isNotEmpty()) {
            builder.addHeader("Authorization", "Bearer $token")
        }
        val effectiveDeviceId = deviceId.ifEmpty { notification.deviceId }
        if (effectiveDeviceId.isNotEmpty()) {
            builder.addHeader("X-Device-Id", effectiveDeviceId)
        }

        return builder.build()
    }

    private fun createBatchRequest(
        url: String,
        token: String,
        payload: NotificationSyncPayload,
        deviceId: String
    ): Request {
        val json = jsonSerializer.encodeToString(payload)
        val mediaType = "application/json; charset=utf-8".toMediaType()
        val body = json.toRequestBody(mediaType)

        val builder = Request.Builder()
            .url(url)
            .post(body)
            .addHeader("User-Agent", "AndroidNotificationListener/1.0")

        if (token.isNotEmpty()) {
            builder.addHeader("Authorization", "Bearer $token")
        }
        val effectiveDeviceId = deviceId.ifEmpty { payload.deviceId }
        if (effectiveDeviceId.isNotEmpty()) {
            builder.addHeader("X-Device-Id", effectiveDeviceId)
        }

        return builder.build()
    }

    fun sendDeviceStatus(
        url: String,
        token: String,
        deviceId: String,
        batteryLevel: Int,
        isCharging: Boolean,
        chargingType: String,
        ringerMode: String
    ) {
        try {
            val statusUrl = if (url.endsWith("/")) "${url}api/status" else "$url/api/status"
            val jsonPayload = """
                {
                    "deviceId": "$deviceId",
                    "batteryLevel": $batteryLevel,
                    "isCharging": $isCharging,
                    "chargingType": "$chargingType",
                    "ringerMode": "$ringerMode"
                }
            """.trimIndent()

            val mediaType = "application/json; charset=utf-8".toMediaType()
            val body = jsonPayload.toRequestBody(mediaType)
            val request = Request.Builder()
                .url(statusUrl)
                .post(body)
                .addHeader("Authorization", "Bearer $token")
                .addHeader("X-Device-Id", deviceId)
                .build()

            client.newCall(request).enqueue(object : Callback {
                override fun onResponse(call: Call, response: Response) {
                    response.close()
                }
                override fun onFailure(call: Call, e: IOException) {
                    Log.w("ExternalCallback", "Failed to report battery status", e)
                }
            })
        } catch (e: Exception) {
            Log.w("ExternalCallback", "Error sending device status", e)
        }
    }

    private var actionWebSocket: WebSocket? = null
    var isWebSocketActive = false
        private set

    val isWebSocketConnected: Boolean
        get() = isWebSocketActive && actionWebSocket != null

    fun startActionWebSocket(
        deviceId: String,
        onActionReceived: (Map<String, String>) -> Unit
    ) {
        val cleanId = deviceId.replace(Regex("[^a-zA-Z0-9]"), "")
        if (cleanId.isEmpty()) return
        val wsUrl = "wss://ntfy.sh/pr_act_${cleanId}/ws"

        val wsClient = client.newBuilder()
            .pingInterval(30, TimeUnit.SECONDS)
            .retryOnConnectionFailure(true)
            .build()

        val request = Request.Builder()
            .url(wsUrl)
            .build()

        isWebSocketActive = true
        actionWebSocket?.close(1000, "Reconnecting")
        actionWebSocket = wsClient.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                Log.i("ExternalCallback", "Real-time action WebSocket connected.")
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                try {
                    val root = jsonSerializer.parseToJsonElement(text) as? kotlinx.serialization.json.JsonObject ?: return
                    val event = (root["event"] as? kotlinx.serialization.json.JsonPrimitive)?.content ?: ""
                    if (event == "message") {
                        val messageBody = (root["message"] as? kotlinx.serialization.json.JsonPrimitive)?.content ?: ""
                        if (messageBody.isNotEmpty()) {
                            val actionObj = jsonSerializer.parseToJsonElement(messageBody) as? kotlinx.serialization.json.JsonObject ?: return
                            val id = (actionObj["id"] as? kotlinx.serialization.json.JsonPrimitive)?.content ?: ""
                            val actionType = (actionObj["actionType"] as? kotlinx.serialization.json.JsonPrimitive)?.content ?: ""
                            val targetKey = (actionObj["targetKey"] as? kotlinx.serialization.json.JsonPrimitive)?.content ?: ""
                            val targetSender = (actionObj["targetSender"] as? kotlinx.serialization.json.JsonPrimitive)?.content ?: ""
                            val targetApp = (actionObj["targetApp"] as? kotlinx.serialization.json.JsonPrimitive)?.content ?: ""
                            val payload = (actionObj["payload"] as? kotlinx.serialization.json.JsonPrimitive)?.content ?: ""

                            if (actionType.isNotEmpty()) {
                                val actionMap = mapOf(
                                    "id" to id,
                                    "actionType" to actionType,
                                    "targetKey" to targetKey,
                                    "targetSender" to targetSender,
                                    "targetApp" to targetApp,
                                    "payload" to payload
                                )
                                onActionReceived(actionMap)
                            }
                        }
                    }
                } catch (e: Exception) {
                    Log.w("ExternalCallback", "Error parsing incoming WebSocket action", e)
                }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                Log.w("ExternalCallback", "WebSocket connection failure: ${t.message}")
                if (isWebSocketActive) {
                    CoroutineScope(Dispatchers.IO).launch {
                        delay(5000L)
                        if (isWebSocketActive) {
                            startActionWebSocket(deviceId, onActionReceived)
                        }
                    }
                }
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                Log.i("ExternalCallback", "WebSocket closed: $reason")
                if (isWebSocketActive && code != 1000) {
                    CoroutineScope(Dispatchers.IO).launch {
                        delay(5000L)
                        if (isWebSocketActive) {
                            startActionWebSocket(deviceId, onActionReceived)
                        }
                    }
                }
            }
        })
    }

    fun stopActionWebSocket() {
        isWebSocketActive = false
        actionWebSocket?.close(1000, "Service stopped")
        actionWebSocket = null
    }

    fun fetchPendingActions(
        url: String,
        token: String,
        deviceId: String,
        callback: (List<Pair<String, Map<String, String>>>) -> Unit
    ) {
        try {
            val actionsUrl = if (url.endsWith("/")) "${url}api/actions/pending?deviceId=$deviceId" else "$url/api/actions/pending?deviceId=$deviceId"
            val request = Request.Builder()
                .url(actionsUrl)
                .get()
                .addHeader("Authorization", "Bearer $token")
                .addHeader("X-Device-Id", deviceId)
                .build()

            client.newCall(request).enqueue(object : Callback {
                override fun onResponse(call: Call, response: Response) {
                    response.use {
                        if (!response.isSuccessful) {
                            callback(emptyList())
                            return
                        }
                        val bodyStr = response.body?.string() ?: ""
                        // Lightweight parsing for actions
                        val actionsList = mutableListOf<Pair<String, Map<String, String>>>()
                        try {
                            val jsonElement = jsonSerializer.parseToJsonElement(bodyStr)
                            val actionsArray = (jsonElement as? kotlinx.serialization.json.JsonObject)?.get("actions") as? kotlinx.serialization.json.JsonArray
                            actionsArray?.forEach { actElement ->
                                val obj = actElement as? kotlinx.serialization.json.JsonObject ?: return@forEach
                                val id = (obj["id"] as? kotlinx.serialization.json.JsonPrimitive)?.content ?: ""
                                val actionType = (obj["actionType"] as? kotlinx.serialization.json.JsonPrimitive)?.content ?: ""
                                val targetKey = (obj["targetKey"] as? kotlinx.serialization.json.JsonPrimitive)?.content ?: ""
                                val targetSender = (obj["targetSender"] as? kotlinx.serialization.json.JsonPrimitive)?.content ?: ""
                                val targetApp = (obj["targetApp"] as? kotlinx.serialization.json.JsonPrimitive)?.content ?: ""
                                val payload = (obj["payload"] as? kotlinx.serialization.json.JsonPrimitive)?.content ?: ""

                                if (id.isNotEmpty() && actionType.isNotEmpty()) {
                                    val map = mapOf(
                                        "id" to id,
                                        "actionType" to actionType,
                                        "targetKey" to targetKey,
                                        "targetSender" to targetSender,
                                        "targetApp" to targetApp,
                                        "payload" to payload
                                    )
                                    actionsList.add(Pair(id, map))
                                }
                            }
                        } catch (e: Exception) {
                            Log.w("ExternalCallback", "Failed parsing pending actions", e)
                        }
                        callback(actionsList)
                    }
                }

                override fun onFailure(call: Call, e: IOException) {
                    callback(emptyList())
                }
            })
        } catch (e: Exception) {
            callback(emptyList())
        }
    }

    fun completeAction(
        url: String,
        token: String,
        deviceId: String,
        actionId: String,
        success: Boolean,
        error: String = ""
    ) {
        try {
            val completeUrl = if (url.endsWith("/")) "${url}api/actions/$actionId/complete" else "$url/api/actions/$actionId/complete"
            val jsonPayload = """{"deviceId":"$deviceId","success":$success,"error":"$error"}"""
            val mediaType = "application/json; charset=utf-8".toMediaType()
            val body = jsonPayload.toRequestBody(mediaType)

            val request = Request.Builder()
                .url(completeUrl)
                .post(body)
                .addHeader("Authorization", "Bearer $token")
                .addHeader("X-Device-Id", deviceId)
                .build()

            client.newCall(request).enqueue(object : Callback {
                override fun onResponse(call: Call, response: Response) { response.close() }
                override fun onFailure(call: Call, e: IOException) {}
            })
        } catch (e: Exception) {}
    }

    fun updateSecretKeyAsync(
        url: String,
        token: String,
        deviceId: String,
        oldKey: String,
        newKey: String,
        callback: (Boolean, String) -> Unit
    ) {
        try {
            val base = if (url.contains("/api/")) url.substringBefore("/api/") else url.trimEnd('/')
            val endpoint = "$base/api/settings/secret-key"
            val jsonPayload = """{"deviceId":"$deviceId","oldKey":"$oldKey","newKey":"$newKey"}"""
            val mediaType = "application/json; charset=utf-8".toMediaType()
            val body = jsonPayload.toRequestBody(mediaType)

            val request = Request.Builder()
                .url(endpoint)
                .post(body)
                .apply {
                    if (token.isNotBlank()) addHeader("Authorization", "Bearer $token")
                    addHeader("X-Device-Id", deviceId)
                }
                .build()

            client.newCall(request).enqueue(object : Callback {
                override fun onResponse(call: Call, response: Response) {
                    response.use {
                        if (response.isSuccessful) {
                            callback(true, "Secret key synchronized with server!")
                        } else {
                            callback(false, "Server response: HTTP ${response.code}")
                        }
                    }
                }

                override fun onFailure(call: Call, e: IOException) {
                    callback(false, "Network error: ${e.localizedMessage}")
                }
            })
        } catch (e: Exception) {
            callback(false, "Error: ${e.localizedMessage}")
        }
    }

    fun pingApiHealth(url: String, callback: (Boolean, Long, String) -> Unit) {
        val start = System.currentTimeMillis()
        try {
            val base = if (url.contains("/api/")) url.substringBefore("/api/") else url.trimEnd('/')
            val probeUrl = "$base/health"
            val request = Request.Builder().url(probeUrl).get().build()
            client.newCall(request).enqueue(object : Callback {
                override fun onResponse(call: Call, response: Response) {
                    val elapsed = System.currentTimeMillis() - start
                    response.use {
                        callback(response.isSuccessful, elapsed, "HTTP ${response.code} (${elapsed}ms)")
                    }
                }
                override fun onFailure(call: Call, e: IOException) {
                    val elapsed = System.currentTimeMillis() - start
                    callback(false, elapsed, "Failed: ${e.localizedMessage}")
                }
            })
        } catch (e: Exception) {
            val elapsed = System.currentTimeMillis() - start
            callback(false, elapsed, "Exception: ${e.localizedMessage}")
        }
    }

    fun testEndpoint(
        url: String,
        token: String,
        deviceId: String,
        endpointPath: String,
        callback: (Boolean, Int, Long, String) -> Unit
    ) {
        val start = System.currentTimeMillis()
        try {
            val base = if (url.contains("/api/")) url.substringBefore("/api/") else url.trimEnd('/')
            val cleanPath = if (endpointPath.startsWith("/")) endpointPath else "/$endpointPath"
            val fullUrl = "$base$cleanPath"

            val builder = Request.Builder().url(fullUrl).get()
            if (token.isNotBlank()) builder.addHeader("Authorization", "Bearer $token")
            if (deviceId.isNotBlank()) builder.addHeader("X-Device-Id", deviceId)

            client.newCall(builder.build()).enqueue(object : Callback {
                override fun onResponse(call: Call, response: Response) {
                    val elapsed = System.currentTimeMillis() - start
                    response.use {
                        val body = response.body?.string()?.take(300) ?: ""
                        callback(response.isSuccessful, response.code, elapsed, body)
                    }
                }
                override fun onFailure(call: Call, e: IOException) {
                    val elapsed = System.currentTimeMillis() - start
                    callback(false, 0, elapsed, e.localizedMessage ?: "Network error")
                }
            })
        } catch (e: Exception) {
            val elapsed = System.currentTimeMillis() - start
            callback(false, 0, elapsed, e.localizedMessage ?: "Request error")
        }
    }

    fun fetchQuota(
        url: String,
        token: String,
        deviceId: String,
        callback: (Boolean, String?) -> Unit
    ) {
        try {
            val base = if (url.contains("/api/")) url.substringBefore("/api/") else url.trimEnd('/')
            val fullUrl = "$base/api/quota?deviceId=$deviceId"
            val builder = Request.Builder().url(fullUrl).get()
            if (token.isNotBlank()) builder.addHeader("Authorization", "Bearer $token")
            if (deviceId.isNotBlank()) builder.addHeader("X-Device-Id", deviceId)

            client.newCall(builder.build()).enqueue(object : Callback {
                override fun onResponse(call: Call, response: Response) {
                    response.use {
                        if (response.isSuccessful) {
                            val body = response.body?.string()
                            callback(true, body)
                        } else {
                            callback(false, null)
                        }
                    }
                }
                override fun onFailure(call: Call, e: IOException) {
                    callback(false, null)
                }
            })
        } catch (e: Exception) {
            callback(false, null)
        }
    }
}

