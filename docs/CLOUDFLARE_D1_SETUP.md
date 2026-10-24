# Zero-Cost Cloudflare Workers + D1 Setup Guide

This guide walks you through deploying the **Phone Reader** backend on Cloudflare's **Free Tier** with **absolutely zero financial risk** (no credit card required, hard usage cutoffs, no unexpected bills).

---

## 1. Cloudflare Free Tier Safeguards & Realities

| Metric | Free Tier Allowance | Personal Phone Reader Consumption | What Happens at the Limit? |
| :--- | :--- | :--- | :--- |
| **Worker Requests** | **100,000 requests/day** (resets 00:00 UTC) | ~100 to 500 requests/day | Cloudflare returns **HTTP 1027 / 429** and drops traffic. **Zero auto-charges.** |
| **D1 Rows Read** | **5,000,000 rows/day** | < 5,000 rows/day | D1 queries return errors until midnight UTC. **No billing.** |
| **D1 Rows Written** | **100,000 rows/day** | < 1,000 rows/day | Subsequent writes fail. **No billing.** |
| **D1 Storage** | **5 GB total** | < 5 MB (with auto-pruning) | Database blocks new writes until old records are deleted. |
| **Credit Card Requirement** | **None** | N/A | **A credit card is NEVER required to deploy or run Workers + D1 on the Free plan.** |

> [!NOTE]
> Unlike AWS, Cloudflare's Free plan enforces a **fail-closed** architecture: when limits are exceeded, service is throttled or suspended until the daily UTC reset. It cannot charge you money because no payment method is attached to your account.

---

## 2. Prerequisites

* **Node.js**: Version 18 or later (already installed on your Windows PC).
* **Cloudflare Free Account**: Register at [cloudflare.com](https://dash.cloudflare.com/sign-up) (Select Free Plan; do **not** enter billing details).

---

## 3. Step-by-Step Deployment (Run from `cloudflare/`)

Open PowerShell on your Windows PC and navigate to the `cloudflare` directory:

```powershell
cd C:\Projects\android-notification-listener-main\cloudflare
```

### Step 3.1: Log in to Cloudflare CLI (Wrangler)
```powershell
npx wrangler login
```
* Your default web browser will open to Cloudflare's authorization page.
* Click **Allow** to grant Wrangler access to your free Cloudflare account.

---

### Step 3.2: Create the D1 Database
Execute the following command to provision your serverless SQLite database on Cloudflare's edge:

```powershell
npx wrangler d1 create phone_reader_db
```

**Expected output:**
```
[[d1_databases]]
binding = "DB"
database_name = "phone_reader_db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

1. Copy the generated `database_id` UUID.
2. Open `cloudflare/wrangler.toml` in your editor.
3. Replace `YOUR_D1_DATABASE_ID_PLACEHOLDER` with your actual `database_id`:
   ```toml
   [[d1_databases]]
   binding = "DB"
   database_name = "phone_reader_db"
   database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
   ```

---

### Step 3.3: Initialize the Database Schema
Apply the SQL schema to create the `notifications` table and indexes:

```powershell
npx wrangler d1 execute phone_reader_db --file=schema.sql --remote
```

* This creates the `notifications` table and query indexes on Cloudflare's edge.

---

### Step 3.4: Set Your Secret API Token
To ensure your notification data is private and secure, set a secret bearer token. Never put this token in code or configuration files.

Generate a strong random token (or create your own 32-character secret) and pass it to Wrangler:

```powershell
npx wrangler secret put API_TOKEN
```
* When prompted: `Enter a secret value: **********`
* Paste your secret token and press Enter. Wrangler will encrypt and store it securely in Cloudflare's secret manager.

---

### Step 3.5: Deploy the Worker
Deploy your code to Cloudflare's global edge network:

```powershell
npx wrangler deploy
```

**Expected output:**
```
Total Upload: xx.xx KiB / gzip: xx.xx KiB
Uploaded phone-reader-api (x.xx sec)
Published phone-reader-api (x.xx sec)
  https://phone-reader-api.<your-subdomain>.workers.dev
Current Deployment ID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

Copy the deployed URL (e.g., `https://phone-reader-api.<your-subdomain>.workers.dev`).

---

## 4. Verification

### Test the Public Health Check
In PowerShell:
```powershell
curl https://phone-reader-api.<your-subdomain>.workers.dev/api/health
```
**Expected response:**
```json
{"status":"ok","service":"phone-reader-cloudflare-worker","timestamp":1700000000000}
```

### Test Authentication
Try to access active notifications without a token:
```powershell
curl https://phone-reader-api.<your-subdomain>.workers.dev/api/notifications/active?deviceId=test-device
```
**Expected response:** HTTP 401 Unauthorized (`{"error":"Unauthorized: Missing Authorization header with Bearer token."}`)

Try with your Bearer token:
```powershell
curl -H "Authorization: Bearer <YOUR_SECRET_TOKEN>" "https://phone-reader-api.<your-subdomain>.workers.dev/api/notifications/active?deviceId=test-device"
```
**Expected response:** HTTP 200 OK (`{"success":true,"deviceId":"test-device","count":0,"notifications":[]}`)

---

## 5. Connecting the Android App

1. Open the **Phone Reader** app on your Android phone.
2. In the app settings screen:
   * **Callback URL**: Enter `https://phone-reader-api.<your-subdomain>.workers.dev/api/notifications`
   * **Auth Token**: Enter your secret `API_TOKEN`.
   * **Package Filter**: Enter `.*whatsapp.*|.*instagram.*|.*android\.gm.*` (or your preferred apps).
   * **Device ID**: Note the displayed Device ID UUID (you will need it for the Alexa skill).
3. Tap **Save & Test Sync**.
4. The dashboard will show a green status check indicating successful synchronization!
