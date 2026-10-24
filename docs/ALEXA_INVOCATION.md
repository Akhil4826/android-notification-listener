# Alexa Invocation Guide: Phrases, Regional Rules & Routines

## 1. Critical Alexa Capability Analysis & Technical Realities

### Built-in System Phrases vs. Custom Skills
When you say:
- *"Alexa, what are my notifications?"*
- *"Alexa, read my notifications."*

Alexa routes this request **exclusively to Amazon's internal shopping notification system** (such as package delivery updates from Amazon.in or Amazon.com).

> [!WARNING]
> Amazon **does not allow** third-party or personal custom skills to override built-in system keywords like "notifications" without using an invocation name. A custom skill **cannot** intercept system-level commands or replace the built-in notification bell.

### Regional Availability: Echo Dot Max in India (`en-IN`)
In India (`en-IN` locale):
1. **Name-free invocation** (conversational AI routing where Alexa guesses the skill) is restricted primarily to top commercial enterprise skills and does not reliably route personal development skills.
2. Therefore, **explicit invocation** using your custom skill name (`Phone Reader`) is the official, stable, and guaranteed route.

---

## 2. Exact Invocation Phrases to Use

Always invoke the skill using the baseline pattern:
**"Alexa, ask Phone Reader to [command]"** or **"Alexa, open Phone Reader"**.

### Supported Phrases

| Intent | Exact Phrase You Must Speak | Alexa Output Example |
| :--- | :--- | :--- |
| **All Active Notifications** | *"Alexa, ask Phone Reader to read my notifications."*<br>*"Alexa, ask Phone Reader to read all my active notifications."* | *"You have 3 active notifications. First, from WhatsApp, John says: Are we still meeting at six? Would you like to hear the next notification?"* |
| **Latest Notification** | *"Alexa, ask Phone Reader what my latest notification says."*<br>*"Alexa, ask Phone Reader to read my latest notification."* | *"Your latest notification is from Instagram. It says: Someone shared a reel with you."* |
| **App-Specific Filtering** | *"Alexa, ask Phone Reader to read my WhatsApp notifications."*<br>*"Alexa, ask Phone Reader what Instagram sent me."* | *"Your latest WhatsApp notification says: Are we still meeting at six?"* |
| **Notification Count / Summary** | *"Alexa, ask Phone Reader how many notifications do I have."* | *"You have 3 active notifications: 2 from WhatsApp and 1 from Instagram."* |
| **Pagination (Next)** | *"Next."*<br>*"Yes."*<br>*"Alexa, ask Phone Reader to read the next notification."* | *"Second, from Gmail, Work Team says: Weekly Project Status Report. Would you like to hear the next one?"* |
| **Repeat Previous** | *"Repeat that."*<br>*"What was that again?"*<br>*"Alexa, ask Phone Reader to repeat that."* | *"Repeating: from WhatsApp, John says: Are we still meeting at six? Would you like to hear the next one?"* |
| **Exit / Done** | *"No."*<br>*"Stop."*<br>*"Cancel."* | *"Okay."* or *"Goodbye."* |

---

## 3. How to Get "Short / Name-Free" Invocation via Alexa Routines

If you prefer saying **"Alexa, my phone"** or **"Alexa, read phone"** without saying "ask Phone Reader" every time, you can configure an **Alexa Routine** in the Alexa app on your smartphone in 60 seconds:

### Step-by-Step Routine Setup:
1. Open the **Amazon Alexa** app on your phone.
2. Tap **More** (bottom right) > **Routines**.
3. Tap the **+** (plus icon) to create a new routine.
4. **Name**: `Phone Notifications`
5. **When this happens**:
   - Tap **Voice**.
   - Enter your preferred short phrase, for example:
     - `read phone`
     - `my phone`
     - `check phone`
6. **Add action**:
   - Tap **Custom**.
   - Type the exact command:
     `ask Phone Reader to read my notifications`
7. **Choose device**:
   - Select **The device you speak to** (or select your Echo Dot Max).
8. Tap **Save**.

### Result:
Whenever you say:
> *"Alexa, read phone"*

Alexa will automatically execute *"ask Phone Reader to read my notifications"* and speak your phone notifications through your Echo Dot Max!
