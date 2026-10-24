# Complete Beginner Setup Guide: Phone Reader

This guide walks you through setting up your personal Phone Reader system from scratch:
1. Installing the Android Notification Listener app on your phone.
2. Deploying the free AWS backend (DynamoDB + Lambda + API Gateway).
3. Creating and linking the Alexa custom skill in the Amazon Developer Console.
4. Testing everything on your Amazon Echo Dot Max.

---

## Part 1: Android Application Setup

### Step 1: Install the App on Your Phone

The debug APK has already been compiled:
`app/build/outputs/apk/debug/app-debug.apk`

You have two easy ways to install it on your Android phone:

#### Method A: Via Android Studio (Recommended)
1. Open this repository folder (`c:\Projects\android-notification-listener-main`) in **Android Studio**.
2. Connect your phone via USB or Wi-Fi (Settings > Developer options > Wireless debugging > Pair device with pairing code).
3. Click the green **Run (▶)** button in Android Studio to build and launch the app directly on your phone.

#### Method B: Via ADB Command Line
Connect your phone with USB Debugging enabled, and run:
```powershell
adb install -r app\build\outputs\apk\debug\app-debug.apk
```

---

### Step 2: Grant Notification Access Permission

Android strictly isolates notifications between applications. You must explicitly grant the app permission to read notifications:

1. Open the **Notification Listener** app on your phone.
2. On the main screen, you will see `Notification Access: Disabled`.
3. Tap **Allow notification access**.
4. Android will open the **Device & app notifications** system screen.
5. Tap **Notification Listener** in the list.
6. Toggle the switch to **Allow**.
7. Return to the app. You should now see:
   - `Notification Access: Enabled` (Green)
   - `Listener Service: Active & Connected` (Green)

---

### Step 3: Configure Android Background & Battery Settings

To ensure Android does not kill the listener service when your phone is locked or sleeping:

1. Go to your phone's **Settings > Apps > Notification Listener**.
2. Tap **Battery** (or Battery usage):
   - Set to **Unrestricted** (or "Don't optimize").
3. For Samsung / Xiaomi / OnePlus devices:
   - Enable **Autostart** or **Allow background activity**.
4. In the app Settings:
   - Keep **Remove permissions when unused** disabled so Android doesn't revoke access automatically after a few weeks.

---

## Part 2: Free AWS Backend Deployment

The backend requires an AWS account (free tier covers 100% of this personal project).

### Prerequisites
1. An AWS Account ([aws.amazon.com/free](https://aws.amazon.com/free)).
2. [AWS CLI](https://aws.amazon.com/cli/) installed and configured (`aws configure`).
3. [AWS SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html) installed.

### Step 1: Deploy with One Command

Open PowerShell in the `infrastructure/` directory:
```powershell
cd infrastructure
.\deploy.ps1
```

The script will prompt you:
1. **Authorization Token**: Press Enter to auto-generate a secure 32-character token (or supply your own).
2. **Device ID**: Enter a friendly name or the Device ID shown in your Android app Settings (e.g. `my-pixel` or `my-phone`).

### Step 2: Note the Outputs
When deployment finishes, CloudFormation will display:
- **`HttpApiUrl`**: e.g., `https://abc123xyz.execute-api.ap-south-1.amazonaws.com/api/notifications`
- **`AlexaFunctionArn`**: e.g., `arn:aws:lambda:ap-south-1:123456789012:function:phone-reader-PhoneReaderAlexaFunction-XYZ`
- **`HealthCheckUrl`**: e.g., `https://abc123xyz.execute-api.ap-south-1.amazonaws.com/api/health`

Verify the health check in your browser or curl:
```bash
curl https://abc123xyz.execute-api.ap-south-1.amazonaws.com/api/health
```
It will return: `{"status":"ok","service":"phone-reader-backend","timestamp":...}`.

---

### Step 3: Configure Android App Remote Server

1. Open **Notification Listener** on your phone.
2. Tap **Open settings**.
3. Under **Remote Server**:
   - **Remote URL**: Enter your `HttpApiUrl` (e.g., `https://abc123xyz.execute-api.ap-south-1.amazonaws.com/api/notifications`).
   - **Authorization Token**: Enter the secret token you used during deployment.
4. Note your **Device ID** displayed at the bottom of the screen (or tap **Copy Device ID**).
5. Tap **Back** to return to the main screen.
6. Tap **Sync active notifications**.
   - You should see a toast: `Synchronized X active notifications`.
   - Under Sync status, you will see `Success (200)` in green!

---

## Part 3: Amazon Alexa Custom Skill Setup

You do NOT need a paid Alexa developer account. A standard Amazon account is free.

### Step 1: Log in to Alexa Developer Console
1. Go to [developer.amazon.com/alexa/console/ask](https://developer.amazon.com/alexa/console/ask).
2. Sign in with the **same Amazon account** that is registered to your Echo Dot Max!

### Step 2: Create the Custom Skill
1. Click **Create Skill**.
2. **Skill name**: `Phone Reader`
3. **Primary locale**: Select `English (India)` or `English (US)` matching your Echo device setting.
4. **Choose a model**: Select **Custom**.
5. **Choose a method to host your skill's backend resources**: Select **Provision your own** (because your backend is hosted in your AWS Lambda).
6. Click **Create skill** (top right).
7. On the template selection screen, choose **Start from Scratch** and click **Import Template** or **Continue with template**.

### Step 3: Import Interaction Model
1. In the left navigation, click **Interaction Model > JSON Editor**.
2. Replace all JSON in the editor with the contents of:
   - For English (India): `alexa/models/en-IN.json`
   - For English (US): `alexa/models/en-US.json`
3. Click **Save Model** (top toolbar).
4. Click **Build Model**. Wait ~30 seconds until the build completes.

### Step 4: Configure the Skill Endpoint
1. In the left navigation, click **Endpoint**.
2. Select **AWS Lambda ARN**.
3. In the **Default Region** box, paste your `AlexaFunctionArn` from the AWS deployment output.
4. Copy your **Skill ID** displayed on this page (e.g., `amzn1.ask.skill.12345678-xxxx-xxxx-xxxx-xxxxxxxxxxxx`).
5. Click **Save Endpoints**.

*(Optional: Update your AWS CloudFormation stack with your Alexa Skill ID so the Lambda trigger is restricted strictly to your skill: `.\deploy.ps1 -AlexaSkillId "amzn1.ask.skill.xxxx"`)*

### Step 5: Test in the Alexa Simulator
1. In the top toolbar, click the **Test** tab.
2. Change **Skill testing is enabled in** from `Off` to **Development**.
3. Type or speak: `open phone reader`
4. Alexa will respond:
   *"Welcome to Phone Reader. You can say: read my notifications, what is my latest notification, or read my WhatsApp notifications. How can I help?"*

---

## Part 4: Testing on Your Physical Echo Dot Max

Because you created the skill with the same Amazon account linked to your Echo Dot Max:
1. The skill is **immediately and automatically enabled** on your Echo device in Development mode!
2. Stand in front of your Echo Dot Max and speak:
   - *"Alexa, ask Phone Reader to read my notifications."*
   - *"Alexa, ask Phone Reader what my latest notification says."*
   - *"Alexa, ask Phone Reader to read my WhatsApp notifications."*
   - *"Alexa, ask Phone Reader how many notifications do I have."*

3. Alexa will retrieve your notifications from DynamoDB and speak them aloud cleanly through the Echo speaker!
