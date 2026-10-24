# Security & Privacy Architecture

This document outlines the security controls, privacy protections, and data isolation measures implemented across the Android application, AWS backend, and Alexa custom skill.

---

## 1. Zero Audio Output on Android Device
- The Android application never uses Android Text-To-Speech (TTS), audio tracks, or media players.
- Notifications are announced **strictly through your Amazon Echo Dot Max speaker** upon your voice command.
- When your phone is in your pocket, locked, or on your desk, it remains completely silent.

---

## 2. Authentication & Authorization

### Secret Token Architecture
- Every HTTP request from the Android phone to the AWS backend requires an `Authorization: Bearer <token>` header or `x-api-key` header.
- The token is verified using **constant-time cryptographic comparison** (`crypto.timingSafeEqual`) to prevent timing attacks.
- Tokens are stored exclusively in Android `EncryptedSharedPreferences` / private app storage on the phone and environment variables in AWS Lambda.
- Tokens are **never hardcoded** in public source code or committed to Git.

### Device Segregation
- Each phone generates or configures a unique `deviceId` (UUID).
- The backend partitions all DynamoDB records by `deviceId`.
- Even if multiple devices use the same backend, device A can never retrieve or view notifications captured from device B.

---

## 3. Log Sanitization & CloudWatch Privacy
A common privacy hazard in cloud projects is logging message bodies in debugging logs.
- The backend API logs HTTP status codes, event counts, and request methods, but **never logs notification titles, message text, bigText, or authorization tokens**.
- The Alexa skill logs only request types and error messages.
- Your personal messages and email subjects remain private in DynamoDB.

---

## 4. Lock Screen & Redacted Notifications Policy
- Android has a system setting: **Settings > Notifications > Lock screen notifications** (Show all content, Hide sensitive content, or Don't show notifications).
- If your phone is locked and an app hides message content (e.g. displaying only "1 new message" or blank content), the Android `StatusBarNotification` will provide empty text.
- In this scenario:
  - `contentAvailable` is automatically set to `false`.
  - Alexa will speak: *"You have a notification from [App], but its message content isn't available."*
  - The skill **never invents** notification text or leaks unexposed content.

---

## 5. Privacy Mode: Announce App Name Only
If you often have guests or family near your Echo Dot Max:
- You can enable **Announce app only (privacy mode)** in the Android app Settings (or via `PRIVACY_MODE=true` in AWS Lambda).
- When enabled:
  - Alexa announces: *"Your latest notification is from WhatsApp"* or *"You have a notification from Instagram."*
  - Alexa does **not read the message body or sender text aloud**.

---

## 6. Retention Policy & Data Wipe Mechanism

### Automatic Cloud Deletion (TTL)
- Every notification stored in DynamoDB has an epoch timestamp attribute `ttl`.
- DynamoDB's Time-To-Live engine automatically purges expired records at zero operational cost without writing deletion scripts.
- Default retention: 7 days (configurable via `RETENTION_DAYS`).

### Local Device Cleanup
- A daily Android WorkManager job (`CleanupWorker`) deletes synced records older than the configured retention threshold from the phone's Room database.

### On-Demand Data Wipe
- **In Android App**: Tap **Clear stored notifications** in Settings to instantly wipe the local Room database.
- **In Backend API**: A `DELETE /api/notifications?deviceId=...` endpoint is provided to delete all remote cloud notifications on demand.
