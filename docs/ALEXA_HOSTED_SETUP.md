# Zero-Cost Alexa-Hosted Skill Setup Guide (Echo Dot Max)

This guide walks you through deploying your **Phone Reader** custom skill directly within the **Amazon Alexa Developer Console** as an **Alexa-Hosted Skill**. 

---

## 1. Zero-Cost & Alexa-Hosted Guarantees

| Metric | Alexa-Hosted Allowance | Personal Phone Reader Consumption | Financial Risk |
| :--- | :--- | :--- | :--- |
| **Hosting Model** | **Alexa-Hosted (Node.js)** | Runs standard Node.js on Amazon's internal cloud | **₹0.00 Guaranteed** |
| **AWS Account** | **Not Required** | Skill runs inside Amazon's own developer infrastructure | **No billing account exists** |
| **Credit Card** | **Not Required** | Amazon never asks for payment info for Alexa-Hosted skills | **Impossible to bill** |
| **Compute Allowance** | **1,000,000 Lambda calls/mo** | ~300 to 1,500 voice requests/mo | Stays under 0.15% of limit |
| **Session DynamoDB** | **25 MB free table** | In-memory session attributes only | Zero consumption |

---

## 2. Step-by-Step Alexa Console Setup

### Step 2.1: Create the Skill
1. Open the [Alexa Developer Console](https://developer.amazon.com/alexa/console/ask) in your web browser.
2. Sign in with the **same Amazon account** that is registered to your physical **Echo Dot Max**.
3. Click **Create Skill** (top right).
4. Configure skill creation:
   * **Skill name:** `Phone Reader`
   * **Primary locale:** Select **English (IN)** (Critical for Echo Dot Max in India).
   * **Experience / Model:** Select **Other**, then choose **Custom**.
   * **Hosting method:** Select **Alexa-hosted (Node.js)**.
5. Click **Next** (top right), then click **Create Skill**.
6. Wait 60 seconds while Amazon provisions your free backend environment.

---

### Step 2.2: Import the Interaction Model (`en-IN.json`)
1. Click the **Build** tab at the top.
2. In the left navigation sidebar, navigate to:  
   **Interaction Model > JSON Editor**.
3. Open `alexa/models/en-IN.json` from this repository on your PC.
4. Copy the entire JSON content of `en-IN.json` and paste it into the JSON Editor in the browser (replacing any starter template).
5. Click **Save Model** at the top.
6. Click **Build Model**.
7. Wait 30–60 seconds until the green notification appears: *"Model built successfully"*.

---

### Step 2.3: Copy the Skill Code
1. Click the **Code** tab at the top.
2. You will see a web-based code editor showing files in your skill's repository.
3. In the left file tree, ensure `package.json` has the dependencies:
   ```json
   {
     "name": "phone-reader-alexa-skill",
     "version": "1.0.0",
     "description": "Amazon Alexa Custom Skill for Personal Phone Notification Reader",
     "main": "index.js",
     "dependencies": {
       "ask-sdk-core": "^2.14.0",
       "ask-sdk-model": "^1.40.0"
     }
   }
   ```
4. Replace `index.js` in the editor with the complete contents of `alexa/src/index.js`.
5. Create a folder named `services/`:
   * Click the **Create File** icon. Name it: `services/speechFormatter.js`. Paste the contents of `alexa/src/services/speechFormatter.js`.
   * Click **Create File** again. Name it: `services/notificationService.js`. Paste the contents of `alexa/src/services/notificationService.js`.

---

### Step 2.4: Set Environment Variables (Zero Hardcoded Secrets)
Amazon Alexa-Hosted Skills provide a secure GUI for environment variables:

1. In the **Code** tab, look at the bottom left panel and click **Environment Variables**.
2. Add the following key-value pairs:

| Variable Name | Value | Description |
| :--- | :--- | :--- |
| `BACKEND_URL` | `https://phone-reader-api.<your-subdomain>.workers.dev` | Your deployed Cloudflare Worker URL |
| `API_TOKEN` | `<YOUR_SECRET_TOKEN>` | Same secret token configured in Cloudflare & Android app |
| `DEVICE_ID` | `<YOUR_DEVICE_UUID>` | Device ID UUID shown on your Android Phone Reader app |
| `PRIVACY_MODE` | `false` | Set to `true` if you only want app names spoken, not contents |

3. Click **Save**.
4. Click **Deploy** (top right of the Code tab).
5. Wait for the green notification: *"Deployment successful"*.

---

## 3. Testing Your Voice Flow

### Testing in the Alexa Simulator (In Browser)
1. Click the **Test** tab at the top.
2. Change **"Skill testing is enabled in:"** from *Off* to **Development**.
3. In the input box, type or say:
   ```
   open phone reader
   ```
   * Alexa will reply: *"Welcome to Phone Reader. You can say: read my notifications, what is my latest notification, or read my WhatsApp notifications. How can I help?"*
4. Test specific commands:
   * `read my notifications`
   * `what is my latest notification`
   * `read my whatsapp notifications`
   * `how many notifications do I have`
   * `clear my notifications`

---

## 4. Testing on Physical Echo Dot Max in India

Because your skill is in **Development** mode on your Amazon account, it is **instantly available on all Echo devices logged into that same account**:

1. Ensure your Echo Dot Max is connected to home Wi-Fi and online.
2. Say directly to your Echo Dot Max:
   > *"Alexa, ask Phone Reader to read my notifications."*
   > 
   > *"Alexa, ask Phone Reader what my latest notification says."*
   > 
   > *"Alexa, ask Phone Reader to read my WhatsApp notifications."*
   > 
   > *"Alexa, ask Phone Reader how many notifications I have."*
   > 
   > *"Alexa, ask Phone Reader to clear my notifications."*

---

## 5. Potential Regional & Linguistic Nuances (India / en-IN)

1. **Device Language Mismatch:**
   * Your Echo Dot Max language setting must match the skill locale.
   * Open the **Amazon Alexa App** on your phone:
     * Navigate to: **More > Settings > Device Settings > Select your Echo Dot Max > Language**.
     * Ensure the language is set to **English (India)** or **English (India) / हिन्दी**.
     * If the Echo is set to US English and the skill is only en-IN, Alexa will say: *"I couldn't find a skill called Phone Reader"*.
2. **Indian Contact Name Pronunciation:**
   * Notification titles often contain Indian names in WhatsApp (e.g., *Aarav, Priya, Vikram, Sneha*).
   * Alexa's Indian English acoustic model handles these names naturally.
3. **Emojis in Message Titles & Text:**
   * WhatsApp and Instagram notifications frequently contain emojis (e.g. *Alice ❤️: Hey!*).
   * The Android app's `Notification.kt` sanitizer automatically strips unprintable emojis and non-standard control characters, preventing Alexa from speaking raw Unicode code points or choking on unexpected characters.
