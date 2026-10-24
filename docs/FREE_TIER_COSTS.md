# AWS Free Tier Analysis, Potential Costs & Safeguards

This project is architected specifically for personal use to run within the free tier limits of Amazon Web Services (AWS) without requiring paid subscriptions, paid AI models, or dedicated servers.

---

## 1. AWS Free Tier Breakdown

| AWS Service | Free Tier Allowance | Personal Phone Reader Monthly Consumption | Estimated Monthly Cost |
| :--- | :--- | :--- | :--- |
| **AWS Lambda** | **1,000,000 requests per month free** (Always Free)<br>+ 3.2M seconds of ARM compute | ~3,000 to 15,000 requests/month (assuming 100-500 notifications/day) | **$0.00** |
| **Amazon DynamoDB** | **25 GB storage free** (Always Free)<br>+ 25 Read Capacity Units (RCU) & 25 Write Capacity Units (WCU) | ~1 MB storage (with 7-day TTL auto-cleanup)<br>PAY_PER_REQUEST billing mode | **$0.00** |
| **Amazon API Gateway** | **1,000,000 HTTP API calls free per month** for the first 12 months.<br>After 12 months: $1.00 per 1 million calls. | ~5,000 to 15,000 API calls/month | **$0.00** (first 12 mos)<br>< **$0.02/month** thereafter |
| **Amazon CloudWatch** | **5 GB log data ingestion free** (Always Free) | < 10 MB logs/month (message bodies are never logged) | **$0.00** |

> [!NOTE]
> AWS Free Tier policies are determined by Amazon Web Services and are subject to change. Never assume any cloud provider service is guaranteed to remain free forever. Always set a billing alarm as described below.

---

## 2. Architecture Cost Safeguards

### Pay-Per-Request (Serverless)
- No EC2 instances, containers, or virtual machines run in the background.
- If your phone receives zero notifications, **zero compute runs and zero cost is incurred**.
- Both Lambda functions are compiled for AWS Graviton2 (`arm64`), which delivers faster execution times and lower costs than x86_64.

### Automatic Data Purging (TTL)
- DynamoDB Time-To-Live automatically purges records older than 7 days.
- Storage never accumulates beyond a few megabytes, staying well under the 25 GB free ceiling.

---

## 3. Recommended Safeguard: Enable AWS Billing Alarm ($0.01)

To guarantee you are never surprised by unexpected AWS charges:

1. Log into your **AWS Management Console**.
2. Navigate to **Billing and Cost Management > Budgets**.
3. Click **Create budget**.
4. Select **Zero spend budget** (or enter a target threshold of **$1.00 USD**).
5. Enter your email address to receive an instant email notification if spending exceeds $0.01.

---

## 4. Complete Resource Deletion (Teardown)

If you ever wish to completely remove the deployed AWS resources and prevent any future activity:

### Option A: Via PowerShell (Windows)
```powershell
cd infrastructure
.\cleanup.ps1
```

### Option B: Via Bash (Linux/Mac)
```bash
cd infrastructure
./cleanup.sh
```

### Option C: Via AWS Console
1. Open the **AWS CloudFormation Console** in your browser.
2. Select the `phone-reader` stack.
3. Click **Delete**.
4. CloudFormation will automatically delete the API Gateway, both Lambda functions, the IAM execution roles, and the DynamoDB table.
