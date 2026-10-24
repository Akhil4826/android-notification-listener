# Troubleshooting Guide

This guide helps you diagnose and resolve common issues with the Android listener, AWS backend, or Alexa skill.

---

## 1. Android Notification Listener Issues

### Symptom: App says "Notification Access: Disabled"
- **Cause**: Android has not granted notification reading access to the app.
- **Fix**: Tap the **Allow notification access** button in the app to open Android system settings. Ensure the toggle next to **Notification Listener** is turned ON.

### Symptom: App says "Listener Service: Inactive / Reconnecting"
- **Cause**: Android sometimes unbinds NotificationListenerService after an app update, device reboot, or aggressive OEM memory management.
- **Fix**:
  1. Open Android **Settings > Apps > Special app access > Device & app notifications**.
  2. Toggle **Notification Listener** OFF, wait 3 seconds, and toggle it back ON.
  3. Open the app and tap **Sync active notifications**.

### Symptom: Notifications stop arriving when the phone is locked or after a few hours
- **Cause**: Aggressive Android battery optimization killed the background listener.
- **Fix**:
  1. Go to **Settings > Apps > Notification Listener > Battery**.
  2. Select **Unrestricted** (or "Don't optimize").
  3. On Xiaomi/MIUI: Enable **Autostart**.
  4. On Samsung/OnePlus: In **App info**, disable **Pause app activity if unused**.

### Symptom: "Unsynced entries" counter increases (Red status)
- **Cause**: The phone could not reach the backend (e.g. WiFi disconnected or incorrect URL/token).
- **Fix**:
  1. Check **Latest error** at the bottom of the main screen.
  2. Verify your **Remote URL** in Settings starts with `https://` and ends with `/api/notifications`.
  3. Verify the **Authorization Token** matches your AWS `API_TOKEN`.
  4. Tap **Trigger sync manually** to retry once connectivity is restored.

---

## 2. AWS Backend Issues

### Symptom: Sync fails with HTTP 401 Unauthorized or 403 Forbidden
- **Cause**: The bearer token sent by the Android app does not match the `API_TOKEN` configured in AWS Lambda.
- **Fix**:
  1. Open AWS Management Console > **CloudFormation** > `phone-reader` stack > **Parameters**.
  2. Note the `ApiToken` value.
  3. In the Android app Settings, re-enter this token under **Authorization Token**.

### Symptom: Sync fails with "Failed to connect" or SSL error
- **Cause**: The URL was typed with an HTTP instead of HTTPS prefix, or has an invalid hostname.
- **Fix**:
  1. Check your `HttpApiUrl` from SAM output (e.g., `https://xxxxxx.execute-api.ap-south-1.amazonaws.com/api/notifications`).
  2. Test the health check endpoint in your phone browser: `https://xxxxxx.execute-api.ap-south-1.amazonaws.com/api/health`. It should return `{"status":"ok"}`.

---

## 3. Alexa Custom Skill Issues

### Symptom: Alexa says "The target skill's response took too long"
- **Cause**: The Alexa Lambda function timed out or could not access DynamoDB.
- **Fix**:
  1. Verify the Lambda function has the `PhoneReaderNotifications` table in the same AWS region.
  2. Ensure the Lambda timeout is set to 8 seconds (the maximum Alexa allows before speech aborts).
  3. In the AWS CloudWatch console, check `/aws/lambda/phone-reader-PhoneReaderAlexaFunction` log group for exceptions.

### Symptom: Alexa says "You don't have any active notifications right now" when you have notifications on your phone
- **Cause**:
  1. Active notifications have not been synchronized yet.
  2. The `DeviceId` configured in the Alexa Lambda function does not match the Android app's Device ID.
- **Fix**:
  1. In the Android app, tap **Sync active notifications**.
  2. Check the **Device ID** displayed in Android app Settings.
  3. In AWS Lambda Console > `PhoneReaderAlexaFunction` > **Configuration > Environment variables**, verify `DEVICE_ID` matches your Android device ID.

### Symptom: Alexa says "You have a notification, but its message content isn't available"
- **Cause**: Android lock screen privacy is set to "Hide sensitive notification content" while the phone is locked.
- **Fix**:
  1. Go to your phone's **Settings > Notifications > Lock screen notifications**.
  2. Select **Show content** (or "Show conversations, default, and silent").
