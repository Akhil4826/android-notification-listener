const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const { skill } = require('../src/index');
const notificationService = require('../src/services/notificationService');

process.env.NODE_ENV = 'test';
process.env.DEVICE_ID = 'test-device-uuid-123';

function buildRequestEnvelope({
  requestType = 'IntentRequest',
  intentName = 'ReadNotificationsIntent',
  slots = {},
  sessionAttributes = {}
}) {
  const isIntent = requestType === 'IntentRequest';
  return {
    version: '1.0',
    session: {
      new: false,
      sessionId: 'SessionId.test',
      application: { applicationId: 'amzn1.ask.skill.test' },
      attributes: { ...sessionAttributes },
      user: { userId: 'amzn1.ask.account.test' }
    },
    request: {
      type: requestType,
      requestId: 'EdwRequestId.test',
      timestamp: new Date().toISOString(),
      locale: 'en-IN',
      ...(isIntent ? {
        intent: {
          name: intentName,
          confirmationStatus: 'NONE',
          slots
        }
      } : {})
    }
  };
}

describe('Alexa Skill Test Suite', () => {
  beforeEach(() => {
    notificationService.setMockNotifications([]);
  });

  test('LaunchRequest returns welcome greeting and reprompt', async () => {
    const envelope = buildRequestEnvelope({ requestType: 'LaunchRequest' });
    const response = await skill.invoke(envelope);

    const speech = response.response.outputSpeech.ssml;
    assert.ok(speech.includes('Welcome to Mobile Reader') || speech.includes('Welcome to Phone Reader'));
    assert.ok(response.response.reprompt.outputSpeech.ssml.includes('read my notifications'));
    assert.strictEqual(response.response.shouldEndSession, false);
  });

  test('ReadNotificationsIntent handles 0 active notifications', async () => {
    notificationService.setMockNotifications([]);
    const envelope = buildRequestEnvelope({ intentName: 'ReadNotificationsIntent' });
    const response = await skill.invoke(envelope);

    const speech = response.response.outputSpeech.ssml;
    assert.ok(speech.includes("You don't have any active notifications right now"));
    assert.strictEqual(response.response.shouldEndSession, true);
  });

  test('ReadNotificationsIntent handles 1 active notification', async () => {
    notificationService.setMockNotifications([
      {
        id: '1',
        notificationKey: 'k1',
        deviceId: 'test-device-uuid-123',
        packageName: 'com.instagram.android',
        appName: 'Instagram',
        title: 'Instagram',
        text: 'Someone shared a reel with you',
        bigText: 'Someone shared a reel with you',
        contentAvailable: true,
        isActive: true,
        postedAt: 1000
      }
    ]);

    const envelope = buildRequestEnvelope({ intentName: 'ReadNotificationsIntent' });
    const response = await skill.invoke(envelope);

    const speech = response.response.outputSpeech.ssml;
    assert.ok(speech.includes('You have 1 active notification'));
    assert.ok(speech.includes('from Instagram'));
    assert.ok(speech.includes('Someone shared a reel with you'));
    assert.ok(speech.includes('Would you like to reply?'));
    assert.strictEqual(response.response.shouldEndSession, false);
  });

  test('ReadNotificationsIntent handles multiple notifications with pagination prompt', async () => {
    notificationService.setMockNotifications([
      {
        id: '1',
        notificationKey: 'k1',
        deviceId: 'test-device-uuid-123',
        packageName: 'com.whatsapp',
        appName: 'WhatsApp',
        title: 'John',
        text: 'Are we still meeting at six?',
        contentAvailable: true,
        isActive: true,
        postedAt: 2000
      },
      {
        id: '2',
        notificationKey: 'k2',
        deviceId: 'test-device-uuid-123',
        packageName: 'com.instagram.android',
        appName: 'Instagram',
        title: 'Instagram',
        text: 'Someone shared a reel with you',
        contentAvailable: true,
        isActive: true,
        postedAt: 1000
      }
    ]);

    const envelope = buildRequestEnvelope({ intentName: 'ReadNotificationsIntent' });
    const response = await skill.invoke(envelope);

    const speech = response.response.outputSpeech.ssml;
    assert.ok(speech.includes('You have 2 active notifications'));
    assert.ok(speech.includes('First, from WhatsApp, John says: Are we still meeting at six?'));
    assert.ok(speech.includes('Would you like to hear the next notification, or reply?'));
    // Should keep session open for next or reply
    assert.strictEqual(response.response.shouldEndSession, false);
    assert.strictEqual(response.sessionAttributes.currentIndex, 0);
    assert.strictEqual(response.sessionAttributes.notifications.length, 2);
  });

  test('ReadNextNotificationIntent advances pagination to next notification', async () => {
    const notifications = [
      {
        id: '1',
        notificationKey: 'k1',
        appName: 'WhatsApp',
        title: 'John',
        text: 'First message',
        contentAvailable: true,
        isActive: true
      },
      {
        id: '2',
        notificationKey: 'k2',
        appName: 'Instagram',
        title: 'Insta',
        text: 'Second message',
        contentAvailable: true,
        isActive: true
      }
    ];

    const envelope = buildRequestEnvelope({
      intentName: 'ReadNextNotificationIntent',
      sessionAttributes: {
        notifications,
        currentIndex: 0,
        lastSpoken: 'First message'
      }
    });

    const response = await skill.invoke(envelope);
    const speech = response.response.outputSpeech.ssml;

    assert.ok(speech.includes('Second, from Instagram: Second message'));
    assert.ok(speech.includes('That was your last notification. Would you like to reply, or clear these notifications?'));
    assert.strictEqual(response.response.shouldEndSession, false);
    assert.strictEqual(response.sessionAttributes.currentIndex, 1);
    assert.strictEqual(response.sessionAttributes.awaitingClearConfirmation, true);

    // Follow-up: User says YES to clear
    const yesEnvelope = buildRequestEnvelope({
      intentName: 'AMAZON.YesIntent',
      sessionAttributes: response.sessionAttributes
    });
    const yesResponse = await skill.invoke(yesEnvelope);
    assert.ok(yesResponse.response.outputSpeech.ssml.includes('Your notifications have been cleared'));
    assert.strictEqual(yesResponse.response.shouldEndSession, true);
  });

  test('RepeatNotificationIntent repeats the previous notification', async () => {
    const envelope = buildRequestEnvelope({
      intentName: 'RepeatNotificationIntent',
      sessionAttributes: {
        lastSpoken: 'from WhatsApp, John says: Are we still meeting at six?'
      }
    });

    const response = await skill.invoke(envelope);
    const speech = response.response.outputSpeech.ssml;
    assert.ok(speech.includes('Repeating: from WhatsApp, John says: Are we still meeting at six?'));
    assert.strictEqual(response.response.shouldEndSession, false);
  });

  test('ReadLatestNotificationIntent speaks latest notification only', async () => {
    notificationService.setMockNotifications([
      {
        id: '1',
        notificationKey: 'k1',
        appName: 'WhatsApp',
        title: 'John',
        text: 'Are we still meeting at six?',
        contentAvailable: true,
        isActive: true,
        postedAt: 3000
      }
    ]);

    const envelope = buildRequestEnvelope({ intentName: 'ReadLatestNotificationIntent' });
    const response = await skill.invoke(envelope);
    const speech = response.response.outputSpeech.ssml;

    assert.ok(speech.includes('Your latest notification is from WhatsApp'));
    assert.ok(speech.includes('John says: Are we still meeting at six?'));
  });

  test('ReadNotificationsByAppIntent filters by WhatsApp', async () => {
    notificationService.setMockNotifications([
      {
        id: '1',
        notificationKey: 'k1',
        packageName: 'com.whatsapp',
        appName: 'WhatsApp',
        title: 'John',
        text: 'Are we still meeting at six?',
        contentAvailable: true,
        isActive: true,
        postedAt: 1000
      },
      {
        id: '2',
        notificationKey: 'k2',
        packageName: 'com.instagram.android',
        appName: 'Instagram',
        title: 'Insta',
        text: 'Photo liked',
        contentAvailable: true,
        isActive: true,
        postedAt: 2000
      }
    ]);

    const envelope = buildRequestEnvelope({
      intentName: 'ReadNotificationsByAppIntent',
      slots: {
        appName: {
          name: 'appName',
          value: 'WhatsApp'
        }
      }
    });

    const response = await skill.invoke(envelope);
    const speech = response.response.outputSpeech.ssml;

    assert.ok(speech.includes('You have 1 notification from WhatsApp'));
    assert.ok(speech.includes('John says: Are we still meeting at six?'));
    assert.ok(!speech.includes('Photo liked'));
  });

  test('Cleans Hinglish messages, emojis, URLs, and ampersands for natural speech', async () => {
    notificationService.setMockNotifications([
      {
        id: '1',
        notificationKey: 'k-hinglish',
        packageName: 'com.whatsapp',
        appName: 'WhatsApp',
        title: 'Aanya & Rahul',
        text: 'Bhai party kab hai? 🎉 Check this link https://instagram.com/p/123 & call +91 92890 18900 🤤',
        contentAvailable: true,
        isActive: true,
        postedAt: 5000
      }
    ]);

    const envelope = buildRequestEnvelope({ intentName: 'ReadLatestNotificationIntent' });
    const response = await skill.invoke(envelope);
    const speech = response.response.outputSpeech.ssml;

    // Must convert & to and, strip emojis, replace URL with 'a link'
    assert.ok(speech.includes('Aanya and Rahul says: Bhai party kab hai? Check this link a link and call +91 92890 18900'));
    assert.ok(!speech.includes('&amp;'));
    assert.ok(!speech.includes('https://'));
    assert.ok(!speech.includes('🎉'));
    assert.ok(!speech.includes('🤤'));
  });

  test('Handles missing notification content gracefully', async () => {
    notificationService.setMockNotifications([
      {
        id: '1',
        notificationKey: 'k1',
        packageName: 'com.instagram.android',
        appName: 'Instagram',
        title: '',
        text: '',
        bigText: '',
        contentAvailable: false,
        isActive: true,
        postedAt: 1000
      }
    ]);

    const envelope = buildRequestEnvelope({ intentName: 'ReadLatestNotificationIntent' });
    const response = await skill.invoke(envelope);
    const speech = response.response.outputSpeech.ssml;

    assert.ok(speech.includes("You have a notification from Instagram, but its message content isn't available"));
  });

  test('SummarizeNotificationsIntent provides aggregated counts by app', async () => {
    notificationService.setMockNotifications([
      { id: '1', notificationKey: 'k1', appName: 'WhatsApp', isActive: true },
      { id: '2', notificationKey: 'k2', appName: 'WhatsApp', isActive: true },
      { id: '3', notificationKey: 'k3', appName: 'Instagram', isActive: true },
      { id: '4', notificationKey: 'k4', appName: 'Gmail', isActive: true }
    ]);

    const envelope = buildRequestEnvelope({ intentName: 'SummarizeNotificationsIntent' });
    const response = await skill.invoke(envelope);
    const speech = response.response.outputSpeech.ssml;

    assert.ok(speech.includes('You have 4 active notifications'));
    assert.ok(speech.includes('2 from WhatsApp'));
    assert.ok(speech.includes('1 from Instagram'));
    assert.ok(speech.includes('1 from Gmail'));
  });

  test('Stop and Cancel intents exit cleanly with goodbye', async () => {
    const envelope = buildRequestEnvelope({ intentName: 'AMAZON.StopIntent' });
    const response = await skill.invoke(envelope);
    const speech = response.response.outputSpeech.ssml;
    assert.ok(speech.includes('Goodbye'));
    assert.strictEqual(response.response.shouldEndSession, true);
  });

  test('HelpIntent explains available commands', async () => {
    const envelope = buildRequestEnvelope({ intentName: 'AMAZON.HelpIntent' });
    const response = await skill.invoke(envelope);
    const speech = response.response.outputSpeech.ssml;
    assert.ok(speech.includes('Mobile Reader lets you hear notifications') || speech.includes('Phone Reader lets you hear notifications'));
    assert.ok(speech.includes('read my notifications'));
    assert.strictEqual(response.response.shouldEndSession, false);
  });

  test('ClearNotificationsIntent clears stored notifications and confirms to user', async () => {
    notificationService.setMockNotifications([
      { id: '1', notificationKey: 'k1', appName: 'WhatsApp', isActive: true },
      { id: '2', notificationKey: 'k2', appName: 'Instagram', isActive: true }
    ]);

    const envelope = buildRequestEnvelope({ intentName: 'ClearNotificationsIntent' });
    const response = await skill.invoke(envelope);
    const speech = response.response.outputSpeech.ssml;

    assert.ok(speech.includes('Your notifications have been cleared'));
    assert.strictEqual(response.response.shouldEndSession, true);

    // Verify notifications were cleared
    const remaining = await notificationService.fetchActiveNotifications();
    assert.strictEqual(remaining.length, 0);
  });

  test('SetDndIntent toggles DND mode and filters notifications by priority apps', async () => {
    notificationService.setMockNotifications([
      {
        id: '1',
        notificationKey: 'k1',
        appName: 'WhatsApp',
        title: 'Mom',
        text: 'Dinner is ready',
        contentAvailable: true,
        isActive: true,
        postedAt: 1000
      },
      {
        id: '2',
        notificationKey: 'k2',
        appName: 'Twitter',
        title: 'News',
        text: 'Breaking news update',
        contentAvailable: true,
        isActive: true,
        postedAt: 2000
      }
    ]);

    // Enable DND
    const dndEnvelope = buildRequestEnvelope({
      intentName: 'SetDndIntent',
      slots: { status: { name: 'status', value: 'on' } }
    });
    const dndRes = await skill.invoke(dndEnvelope);
    assert.ok(dndRes.response.outputSpeech.ssml.includes('Do Not Disturb is now turned on'));

    // Read notifications with DND enabled -> should only read WhatsApp, not Twitter
    const readEnvelope = buildRequestEnvelope({ intentName: 'ReadNotificationsIntent' });
    const readRes = await skill.invoke(readEnvelope);
    const readSpeech = readRes.response.outputSpeech.ssml;

    assert.ok(readSpeech.includes('Do Not Disturb is on'));
    assert.ok(readSpeech.includes('Dinner is ready'));
    assert.ok(!readSpeech.includes('Breaking news update'));

    // Turn off DND
    const dndOffEnvelope = buildRequestEnvelope({
      intentName: 'SetDndIntent',
      slots: { status: { name: 'status', value: 'off' } }
    });
    const dndOffRes = await skill.invoke(dndOffEnvelope);
    assert.ok(dndOffRes.response.outputSpeech.ssml.includes('Do Not Disturb is now turned off'));
  });

  test('Add and remove priority app intents', async () => {
    // Add Instagram to priority
    const addEnvelope = buildRequestEnvelope({
      intentName: 'AddPriorityAppIntent',
      slots: { appName: { name: 'appName', value: 'Instagram' } }
    });
    const addRes = await skill.invoke(addEnvelope);
    assert.ok(addRes.response.outputSpeech.ssml.includes('Added Instagram to your priority apps'));

    // Check status
    const statusEnvelope = buildRequestEnvelope({ intentName: 'GetDndStatusIntent' });
    const statusRes = await skill.invoke(statusEnvelope);
    assert.ok(statusRes.response.outputSpeech.ssml.includes('Instagram'));

    // Remove Instagram from priority
    const removeEnvelope = buildRequestEnvelope({
      intentName: 'RemovePriorityAppIntent',
      slots: { appName: { name: 'appName', value: 'Instagram' } }
    });
    const removeRes = await skill.invoke(removeEnvelope);
    assert.ok(removeRes.response.outputSpeech.ssml.includes('Removed Instagram from your priority apps'));
  });

  test('Gracefully handles unconfigured device ID error', async () => {
    notificationService.setMockNotifications(null); // Force real path
    const oldDeviceId = process.env.DEVICE_ID;
    delete process.env.DEVICE_ID;

    try {
      const envelope = buildRequestEnvelope({ intentName: 'ReadNotificationsIntent' });
      const response = await skill.invoke(envelope);
      const speech = response.response.outputSpeech.ssml;
      assert.ok(speech.includes('device ID is not configured'));
      assert.strictEqual(response.response.shouldEndSession, true);
    } finally {
      process.env.DEVICE_ID = oldDeviceId;
      notificationService.setMockNotifications([]);
    }
  });

  test('Gracefully handles unconfigured backend URL error', async () => {
    notificationService.setMockNotifications(null); // Force real path
    const oldUrl = process.env.BACKEND_URL;
    delete process.env.BACKEND_URL;
    delete process.env.TABLE_NAME;

    try {
      const envelope = buildRequestEnvelope({ intentName: 'ReadNotificationsIntent' });
      const response = await skill.invoke(envelope);
      const speech = response.response.outputSpeech.ssml;
      assert.ok(speech.includes('backend service URL is not configured'));
      assert.strictEqual(response.response.shouldEndSession, true);
    } finally {
      process.env.BACKEND_URL = oldUrl;
      notificationService.setMockNotifications([]);
    }
  });

  // 19. Relative Spoken Timestamps
  test('Formats natural relative spoken timestamps (just now, minutes ago, yesterday)', () => {
    const { getRelativeTimeString } = require('../src/services/speechFormatter');
    const now = 1729180000000; // Fixed timestamp for testing

    assert.strictEqual(getRelativeTimeString(now - 10000, now), 'just now');
    assert.strictEqual(getRelativeTimeString(now - 60000, now), '1 minute ago');
    assert.strictEqual(getRelativeTimeString(now - 300000, now), '5 minutes ago');
    assert.strictEqual(getRelativeTimeString(now - 7200000, now), '2 hours ago');
    assert.strictEqual(getRelativeTimeString(now - 86400000, now), 'yesterday');
    assert.strictEqual(getRelativeTimeString(now - 259200000, now), '3 days ago');
    assert.strictEqual(getRelativeTimeString(0, now), ''); // Invalid / 0
  });

  // 20. Sender / Contact Search
  test('ReadNotificationsBySenderIntent finds messages from specific contact (e.g. Mom)', async () => {
    const fixedNow = Date.now();
    notificationService.setMockNotifications([
      {
        id: '1',
        notificationKey: 'k1',
        appName: 'WhatsApp',
        title: 'Mom',
        text: 'Call me when free beta',
        contentAvailable: true,
        isActive: true,
        postedAt: fixedNow - 120000 // 2 minutes ago
      },
      {
        id: '2',
        notificationKey: 'k2',
        appName: 'WhatsApp',
        title: 'Rahul Sharma',
        text: 'Meeting at 6?',
        contentAvailable: true,
        isActive: true,
        postedAt: fixedNow - 300000
      }
    ]);

    // Query for Mom
    const envelopeMom = buildRequestEnvelope({
      intentName: 'ReadNotificationsBySenderIntent',
      slots: {
        senderName: { name: 'senderName', value: 'Mom' }
      }
    });
    const resMom = await skill.invoke(envelopeMom);
    const speechMom = resMom.response.outputSpeech.ssml;

    assert.ok(speechMom.includes('You have a message from Mom on WhatsApp'));
    assert.ok(speechMom.includes('Call me when free beta'));
    assert.strictEqual(resMom.response.shouldEndSession, false);

    // Query for alias "Mummy" should match contact saved as "Mom"
    const envelopeMummy = buildRequestEnvelope({
      intentName: 'ReadNotificationsBySenderIntent',
      slots: {
        senderName: { name: 'senderName', value: 'Mummy' }
      }
    });
    const resMummy = await skill.invoke(envelopeMummy);
    const speechMummy = resMummy.response.outputSpeech.ssml;
    assert.ok(speechMummy.includes('You have a message from Mom on WhatsApp'));

    // Query for first name "Rahul" should match contact "Rahul Sharma"
    const envelopeRahul = buildRequestEnvelope({
      intentName: 'ReadNotificationsBySenderIntent',
      slots: {
        senderName: { name: 'senderName', value: 'Rahul' }
      }
    });
    const resRahul = await skill.invoke(envelopeRahul);
    const speechRahul = resRahul.response.outputSpeech.ssml;
    assert.ok(speechRahul.includes('Rahul Sharma'));

    // Query for unknown contact (Dad) when other notifications exist
    const envelopeDad = buildRequestEnvelope({
      intentName: 'ReadNotificationsBySenderIntent',
      slots: {
        senderName: { name: 'senderName', value: 'Dad' }
      }
    });
    const resDad = await skill.invoke(envelopeDad);
    const speechDad = resDad.response.outputSpeech.ssml;
    assert.ok(speechDad.includes("don't have any messages from Dad"));
    assert.ok(speechDad.includes("WhatsApp")); // Mentions other active apps!
    assert.strictEqual(resDad.response.shouldEndSession, false); // Asks if user wants to hear other
  });

  // 21. Real-time Social Usernames & Handles (e.g. Instagram @tanmay_bhat)
  test('ReadNotificationsBySenderIntent matches social handles (@tanmay_bhat) in real-time', async () => {
    notificationService.setMockNotifications([
      {
        id: '1',
        notificationKey: 'ig-1',
        appName: 'Instagram',
        title: '@tanmay_bhat',
        text: 'Bro check out this new video!',
        contentAvailable: true,
        isActive: true,
        postedAt: Date.now() - 30000
      }
    ]);

    const envelope = buildRequestEnvelope({
      intentName: 'ReadNotificationsBySenderIntent',
      slots: {
        senderName: { name: 'senderName', value: 'tanmay' }
      }
    });
    const res = await skill.invoke(envelope);
    const speech = res.response.outputSpeech.ssml;

    assert.ok(speech.includes('Instagram'));
    assert.ok(speech.includes('Bro check out this new video'));
  });

  // 22. WhoMessagedMeIntent: "Who messaged me?"
  test('WhoMessagedMeIntent summarizes everyone who sent messages across apps', async () => {
    notificationService.setMockNotifications([
      { id: '1', notificationKey: 'k1', appName: 'WhatsApp', title: 'Mom', isActive: true },
      { id: '2', notificationKey: 'k2', appName: 'WhatsApp', title: 'Rahul', isActive: true },
      { id: '3', notificationKey: 'k3', appName: 'Instagram', title: 'Priya', isActive: true }
    ]);

    const envelope = buildRequestEnvelope({ intentName: 'WhoMessagedMeIntent' });
    const response = await skill.invoke(envelope);
    const speech = response.response.outputSpeech.ssml;

    assert.ok(speech.includes('Mom and Rahul on WhatsApp'));
    assert.ok(speech.includes('Priya on Instagram'));
    assert.ok(speech.includes('Would you like me to read them?'));
    assert.strictEqual(response.response.shouldEndSession, false);
  });

  // 21. Instant OTP / Verification Code Extractor
  test('ReadOtpIntent extracts 4-8 digit OTP with spaced SSML digits', async () => {
    const fixedNow = Date.now();
    notificationService.setMockNotifications([
      {
        id: '1',
        notificationKey: 'k1',
        appName: 'Messages',
        title: 'HDFC Bank',
        text: '492018 is your secret OTP for transaction at Amazon India. Do not share.',
        contentAvailable: true,
        isActive: true,
        postedAt: fixedNow - 60000 // 1 minute ago
      }
    ]);

    const envelope = buildRequestEnvelope({ intentName: 'ReadOtpIntent' });
    const response = await skill.invoke(envelope);
    const speech = response.response.outputSpeech.ssml;

    assert.ok(speech.includes('Your OTP from HDFC Bank is'));
    assert.ok(speech.includes('<say-as interpret-as="digits">492018</say-as>'));
    assert.ok(speech.includes('492018 is your secret OTP'));
    assert.strictEqual(response.response.shouldEndSession, true);
  });

  test('ReadOtpIntent handles when no OTP was received', async () => {
    notificationService.setMockNotifications([
      {
        id: '1',
        notificationKey: 'k1',
        appName: 'WhatsApp',
        title: 'Rahul',
        text: 'Hello how are you?',
        contentAvailable: true,
        isActive: true
      }
    ]);

    const envelope = buildRequestEnvelope({ intentName: 'ReadOtpIntent' });
    const response = await skill.invoke(envelope);
    const speech = response.response.outputSpeech.ssml;

    assert.ok(speech.includes("haven't received any OTP or verification codes recently"));
    assert.strictEqual(response.response.shouldEndSession, true);
  });

  // 22. Phone status & sync heartbeat
  test('CheckPhoneStatusIntent reports phone connectivity and sync heartbeat', async () => {
    const envelope = buildRequestEnvelope({ intentName: 'CheckPhoneStatusIntent' });
    const response = await skill.invoke(envelope);
    const speech = response.response.outputSpeech.ssml;

    assert.ok(speech.includes('Your phone is connected and active'));
    assert.strictEqual(response.response.shouldEndSession, true);
  });

  // 23. App-specific clear intent
  test('ClearNotificationsByAppIntent clears specific app notifications', async () => {
    notificationService.setMockNotifications([
      { id: '1', notificationKey: 'k1', appName: 'WhatsApp', text: 'W1', isActive: true },
      { id: '2', notificationKey: 'k2', appName: 'Instagram', text: 'I1', isActive: true }
    ]);

    const envelope = buildRequestEnvelope({
      intentName: 'ClearNotificationsByAppIntent',
      slots: {
        appName: { name: 'appName', value: 'WhatsApp' }
      }
    });

    const response = await skill.invoke(envelope);
    const speech = response.response.outputSpeech.ssml;

    assert.ok(speech.includes('Your WhatsApp notifications have been cleared'));
    assert.strictEqual(response.response.shouldEndSession, true);
  });

  // 24. NoIntent keeps notifications when declining clear prompt
  test('NoIntent keeps notifications saved when user declines end-of-pagination clear prompt', async () => {
    const envelope = buildRequestEnvelope({
      intentName: 'AMAZON.NoIntent',
      sessionAttributes: {
        awaitingClearConfirmation: true
      }
    });

    const response = await skill.invoke(envelope);
    const speech = response.response.outputSpeech.ssml;

    assert.ok(speech.includes('keeping your notifications saved'));
    assert.strictEqual(response.response.shouldEndSession, true);
  });

  // 25. ReplyMessageIntent prompts for secret PIN
  test('ReplyMessageIntent asks for four digit secret key before sending', async () => {
    const envelope = buildRequestEnvelope({
      intentName: 'ReplyMessageIntent',
      slots: {
        senderName: { name: 'senderName', value: 'Mom' },
        appName: { name: 'appName', value: 'WhatsApp' },
        replyMessage: { name: 'replyMessage', value: 'I will be there in 10 minutes.' }
      }
    });

    const response = await skill.invoke(envelope);
    const speech = response.response.outputSpeech.ssml;

    assert.ok(speech.includes('Mom'));
    assert.ok(speech.includes('four digit secret key'));
    assert.strictEqual(response.response.shouldEndSession, false);
    assert.ok(response.sessionAttributes.awaitingSecretPinForReply);
    assert.strictEqual(response.sessionAttributes.awaitingSecretPinForReply.replyMessage, 'I will be there in 10 minutes.');
  });

  // 26. ConfirmSecretPinIntent with correct PIN 4826 sends reply
  test('ConfirmSecretPinIntent with correct secret key 4826 authorizes and sends message', async () => {
    const envelope = buildRequestEnvelope({
      intentName: 'ConfirmSecretPinIntent',
      slots: {
        secretPin: { name: 'secretPin', value: '4826' }
      },
      sessionAttributes: {
        awaitingSecretPinForReply: {
          senderName: 'Mom',
          appName: 'WhatsApp',
          replyMessage: 'I will be there in 10 minutes.'
        }
      }
    });

    const response = await skill.invoke(envelope);
    const speech = response.response.outputSpeech.ssml;

    assert.ok(speech.includes('Secret key verified'));
    assert.ok(speech.includes('Your message has been sent to Mom'));
    assert.strictEqual(response.response.shouldEndSession, true);
  });

  // 27. ConfirmSecretPinIntent with wrong PIN cancels reply
  test('ConfirmSecretPinIntent with incorrect secret key cancels message sending', async () => {
    const envelope = buildRequestEnvelope({
      intentName: 'ConfirmSecretPinIntent',
      slots: {
        secretPin: { name: 'secretPin', value: '0000' }
      },
      sessionAttributes: {
        awaitingSecretPinForReply: {
          senderName: 'Mom',
          appName: 'WhatsApp',
          replyMessage: 'I will be there in 10 minutes.'
        }
      }
    });

    const response = await skill.invoke(envelope);
    const speech = response.response.outputSpeech.ssml;

    assert.ok(speech.includes('Incorrect secret key'));
    assert.ok(speech.includes('was cancelled and was not sent'));
    assert.strictEqual(response.response.shouldEndSession, true);
  });

  // 28. ChangeSecretKeyIntent updates user PIN
  test('ChangeSecretKeyIntent allows user to change secret PIN', async () => {
    const envelope = buildRequestEnvelope({
      intentName: 'ChangeSecretKeyIntent',
      slots: {
        oldPin: { name: 'oldPin', value: '4826' },
        newPin: { name: 'newPin', value: '9999' }
      }
    });

    const response = await skill.invoke(envelope);
    const speech = response.response.outputSpeech.ssml;

    assert.ok(speech.includes('successfully updated'));
    assert.strictEqual(response.response.shouldEndSession, true);
  });

  // 29. CheckBatteryIntent reports phone battery
  test('CheckBatteryIntent speaks conversational battery and charging status', async () => {
    const envelope = buildRequestEnvelope({ intentName: 'CheckBatteryIntent' });
    const response = await skill.invoke(envelope);
    const speech = response.response.outputSpeech.ssml;

    assert.ok(speech.includes('battery'));
    assert.strictEqual(response.response.shouldEndSession, true);
  });

  // 30. FindMyPhoneIntent rings and stops phone ringer
  test('FindMyPhoneIntent triggers phone ringer', async () => {
    const envelope = buildRequestEnvelope({ intentName: 'FindMyPhoneIntent' });
    const response = await skill.invoke(envelope);
    const speech = response.response.outputSpeech.ssml;

    assert.ok(speech.includes('Ringing your phone at maximum volume'));
    assert.strictEqual(response.response.shouldEndSession, true);
  });

  // 31. DismissFromPhoneIntent clears phone notification bar
  test('DismissFromPhoneIntent sends phone dismissal command', async () => {
    const envelope = buildRequestEnvelope({
      intentName: 'DismissFromPhoneIntent',
      slots: {
        appName: { name: 'appName', value: 'WhatsApp' }
      }
    });

    const response = await skill.invoke(envelope);
    const speech = response.response.outputSpeech.ssml;

    assert.ok(speech.includes('directly from your phone'));
    assert.strictEqual(response.response.shouldEndSession, true);
  });

  // 32. CheckMissedCallsIntent reports missed calls
  test('CheckMissedCallsIntent reports missed phone calls', async () => {
    notificationService.setMockNotifications([
      {
        id: 'c1',
        notificationKey: 'call-1',
        appName: 'Phone',
        category: 'missed_call',
        title: 'Dad',
        text: 'Missed call from Dad',
        postedAt: Date.now() - 120000,
        isActive: true
      }
    ]);

    const envelope = buildRequestEnvelope({ intentName: 'CheckMissedCallsIntent' });
    const response = await skill.invoke(envelope);
    const speech = response.response.outputSpeech.ssml;

    assert.ok(speech.includes('Dad'));
    assert.ok(speech.includes('missed call'));
    assert.strictEqual(response.response.shouldEndSession, true);
  });

  // 33. DailyBriefingIntent provides audio briefing
  test('DailyBriefingIntent summarizes morning status', async () => {
    const envelope = buildRequestEnvelope({ intentName: 'DailyBriefingIntent' });
    const response = await skill.invoke(envelope);
    const speech = response.response.outputSpeech.ssml;

    assert.ok(speech.includes('briefing'));
    assert.ok(speech.includes('battery'));
  });

  // 34. Natural Language: Direct utterance "message Mom: I will be there in 10 minutes."
  test('Understands direct natural request: "message Mom: I will be there in 10 minutes."', async () => {
    const envelope = buildRequestEnvelope({
      intentName: 'ReplyMessageIntent',
      slots: {
        senderName: { name: 'senderName', value: 'Mom' },
        replyMessage: { name: 'replyMessage', value: ': I will be there in 10 minutes.' }
      }
    });

    const response = await skill.invoke(envelope);
    const speech = response.response.outputSpeech.ssml;

    assert.ok(speech.includes('Mom'));
    assert.ok(speech.includes('I will be there in 10 minutes.'));
    assert.ok(speech.includes('four digit secret key'));
    assert.strictEqual(response.response.shouldEndSession, false);
    assert.strictEqual(response.sessionAttributes.awaitingSecretPinForReply.senderName, 'Mom');
    assert.strictEqual(response.sessionAttributes.awaitingSecretPinForReply.replyMessage, 'I will be there in 10 minutes.');
  });

  // 35. Natural Language: Contextual reply "Yes, tell her: see you tomorrow." resolves pronoun "her" to active contact
  test('Understands contextual reply: "Yes, tell her: see you tomorrow." resolving pronoun to active sender', async () => {
    const envelope = buildRequestEnvelope({
      intentName: 'ReplyMessageIntent',
      sessionAttributes: {
        activeSenderContext: {
          senderName: 'Mom',
          appName: 'WhatsApp',
          notificationKey: 'notif-mom-1'
        }
      },
      slots: {
        senderName: { name: 'senderName', value: 'her' },
        replyMessage: { name: 'replyMessage', value: 'see you tomorrow.' }
      }
    });

    const response = await skill.invoke(envelope);
    const speech = response.response.outputSpeech.ssml;

    assert.ok(speech.includes('Mom'));
    assert.ok(speech.includes('see you tomorrow.'));
    assert.ok(speech.includes('four digit secret key'));
    assert.strictEqual(response.response.shouldEndSession, false);
    assert.strictEqual(response.sessionAttributes.awaitingSecretPinForReply.senderName, 'Mom');
    assert.strictEqual(response.sessionAttributes.awaitingSecretPinForReply.replyMessage, 'see you tomorrow.');
  });

  // 36. Spoken word PIN normalization: "four eight two six" matches 4826
  test('Confirms secret PIN using spoken number words: "four eight two six"', async () => {
    const envelope = buildRequestEnvelope({
      intentName: 'ConfirmSecretPinIntent',
      sessionAttributes: {
        awaitingSecretPinForReply: {
          senderName: 'Mom',
          appName: 'WhatsApp',
          replyMessage: 'I am on my way'
        }
      },
      slots: {
        secretPin: { name: 'secretPin', value: 'four eight two six' }
      }
    });

    const response = await skill.invoke(envelope);
    const speech = response.response.outputSpeech.ssml;

    assert.ok(speech.includes('Secret key verified'));
    assert.ok(speech.includes('Mom'));
    assert.ok(speech.includes('I am on my way'));
    assert.strictEqual(response.response.shouldEndSession, true);
  });

  // 38. Conversational Follow-up: Alexa asks "Would you like to reply?", user says "yes" -> asks for message
  test('YesIntent when awaitingReplyPrompt transitions to asking for message body', async () => {
    const envelope = buildRequestEnvelope({
      intentName: 'AMAZON.YesIntent',
      sessionAttributes: {
        awaitingReplyPrompt: true,
        activeSenderContext: {
          senderName: 'aanyaaa',
          appName: 'Instagram',
          notificationKey: 'k-insta-1'
        }
      }
    });

    const response = await skill.invoke(envelope);
    const speech = response.response.outputSpeech.ssml;

    assert.ok(speech.includes('What message would you like to send to aanyaaa?'));
    assert.strictEqual(response.response.shouldEndSession, false);
    assert.strictEqual(response.sessionAttributes.awaitingReplyMessageBody, true);
  });

  // 39. Answering with message: user says "reply with bye-bye" -> asks for secret key with clean recipient
  test('Replying with message prompts for 4-digit secret key with clean recipient and stores notificationKey', async () => {
    const envelope = buildRequestEnvelope({
      intentName: 'ReplyMessageIntent',
      sessionAttributes: {
        awaitingReplyMessageBody: true,
        activeSenderContext: {
          senderName: 'cutieepie',
          appName: 'Instagram',
          notificationKey: 'k-insta-99'
        }
      },
      slots: {
        replyMessage: { name: 'replyMessage', value: 'reply with bye-bye' }
      }
    });

    const response = await skill.invoke(envelope);
    const speech = response.response.outputSpeech.ssml;

    assert.ok(speech.includes('To confirm sending this message to cutieepie on Instagram: "bye-bye"'));
    assert.ok(speech.includes('four digit secret key'));
    assert.strictEqual(response.response.shouldEndSession, false);
    assert.ok(response.sessionAttributes.awaitingSecretPinForReply);
    assert.strictEqual(response.sessionAttributes.awaitingSecretPinForReply.notificationKey, 'k-insta-99');
    assert.strictEqual(response.sessionAttributes.awaitingSecretPinForReply.replyMessage, 'bye-bye');
  });

  // 40. Fallback with "yes i want to reply to that message"
  test('FallbackIntent handles conversational "yes i want to reply" seamlessly', async () => {
    const envelope = buildRequestEnvelope({
      intentName: 'AMAZON.FallbackIntent',
      sessionAttributes: {
        awaitingReplyPrompt: true,
        activeSenderContext: {
          senderName: 'Aanya',
          appName: 'WhatsApp',
          notificationKey: 'k-wa-100'
        }
      },
      slots: {
        catchAll: { name: 'catchAll', value: 'yes i want to reply to that message' }
      }
    });

    const response = await skill.invoke(envelope);
    const speech = response.response.outputSpeech.ssml;

    assert.ok(speech.includes('What message would you like to send to Aanya?'));
    assert.strictEqual(response.response.shouldEndSession, false);
  });

  // 41. Contact search with noise words: "akhil jio contact"
  test('ReadNotificationsBySenderIntent strips noise words like "contact" and matches "Akhil Jio"', async () => {
    notificationService.setMockNotifications([
      {
        id: '1',
        notificationKey: 'k-akhil',
        appName: 'WhatsApp',
        title: 'Akhil Jio',
        text: 'so yep',
        contentAvailable: true,
        isActive: true,
        postedAt: Date.now() - 5000
      }
    ]);

    const envelope = buildRequestEnvelope({
      intentName: 'ReadNotificationsBySenderIntent',
      slots: {
        senderName: { name: 'senderName', value: 'akhil jio contact' }
      }
    });

    const res = await skill.invoke(envelope);
    const speech = res.response.outputSpeech.ssml;
    assert.ok(speech.includes('Akhil Jio') || speech.includes('akhil jio'));
    assert.ok(speech.includes('so yep'));
    assert.strictEqual(res.response.shouldEndSession, false);
  });

  // 42. Compound query: appName slot + senderName
  test('ReadNotificationsBySenderIntent handles compound query with appName slot', async () => {
    notificationService.setMockNotifications([
      {
        id: '1',
        notificationKey: 'k-akhil-wa',
        appName: 'WhatsApp',
        title: 'Akhil Jio',
        text: 'hey on whatsapp',
        contentAvailable: true,
        isActive: true,
        postedAt: Date.now() - 5000
      },
      {
        id: '2',
        notificationKey: 'k-akhil-ig',
        appName: 'Instagram',
        title: 'Akhil Jio',
        text: 'hey on insta',
        contentAvailable: true,
        isActive: true,
        postedAt: Date.now() - 4000
      }
    ]);

    const envelope = buildRequestEnvelope({
      intentName: 'ReadNotificationsBySenderIntent',
      slots: {
        senderName: { name: 'senderName', value: 'akhil jio' },
        appName: { name: 'appName', value: 'WhatsApp' }
      }
    });

    const res = await skill.invoke(envelope);
    const speech = res.response.outputSpeech.ssml;
    assert.ok(speech.includes('WhatsApp'));
    assert.ok(speech.includes('hey on whatsapp'));
  });

  // 43. Fallback routing for "i want from akhil jio noptification"
  test('FallbackIntent routes "i want from akhil jio noptification" to ReadNotificationsBySenderIntent', async () => {
    notificationService.setMockNotifications([
      {
        id: '1',
        notificationKey: 'k-akhil',
        appName: 'WhatsApp',
        title: 'Akhil Jio',
        text: 'hello back',
        contentAvailable: true,
        isActive: true,
        postedAt: Date.now() - 5000
      }
    ]);

    const envelope = buildRequestEnvelope({
      intentName: 'AMAZON.FallbackIntent',
      slots: {
        catchAll: { name: 'catchAll', value: 'i want from akhil jio noptification' }
      }
    });

    const res = await skill.invoke(envelope);
    const speech = res.response.outputSpeech.ssml;
    assert.ok(speech.includes('Akhil Jio'));
    assert.ok(speech.includes('hello back'));
  });

  // 44. Fallback routing for "open mobile and read my latest whatsapp notifications from akhil jio contact"
  test('FallbackIntent handles compound app and sender query with noise words', async () => {
    notificationService.setMockNotifications([
      {
        id: '1',
        notificationKey: 'k-akhil',
        appName: 'WhatsApp',
        title: 'Akhil Jio',
        text: 'timeline updated',
        contentAvailable: true,
        isActive: true,
        postedAt: Date.now() - 3000
      }
    ]);

    const envelope = buildRequestEnvelope({
      intentName: 'AMAZON.FallbackIntent',
      slots: {
        catchAll: { name: 'catchAll', value: 'open mobile and read my latest whatsapp notifications from akhil jio contact' }
      }
    });

    const res = await skill.invoke(envelope);
    const speech = res.response.outputSpeech.ssml;
    assert.ok(speech.includes('Akhil Jio'));
    assert.ok(speech.includes('timeline updated'));
  });

  // 45. User says "open mobile and send reply to akhil jio on whatsapp"
  test('ReplyMessageIntent or Fallback recognizes "send reply to akhil jio on whatsapp" and prompts for message', async () => {
    const envelope = buildRequestEnvelope({
      intentName: 'ReplyMessageIntent',
      slots: {
        senderName: { name: 'senderName', value: 'akhil jio' },
        appName: { name: 'appName', value: 'WhatsApp' }
      }
    });

    const res = await skill.invoke(envelope);
    const speech = res.response.outputSpeech.ssml;
    assert.ok(speech.includes('What message would you like to send to akhil jio?'));
    assert.strictEqual(res.sessionAttributes.awaitingReplyMessageBody, true);
  });

  // 46. Conversational correction: "reply to a message" -> prompted for recipient -> "to akhil jio" -> prompted for message
  test('Multi-turn reply recovery: user says "reply to a message" then clarifies recipient with "to akhil jio"', async () => {
    // Step 1: User says "reply to a message"
    const envelope1 = buildRequestEnvelope({
      intentName: 'ReplyMessageIntent',
      slots: {
        senderName: { name: 'senderName', value: 'a message' }
      }
    });
    const res1 = await skill.invoke(envelope1);
    const speech1 = res1.response.outputSpeech.ssml;
    assert.ok(speech1.includes('Who would you like to reply to'));
    assert.strictEqual(res1.sessionAttributes.awaitingReplyMessageBody, true);

    // Step 2: User says "to akhil jio" while awaitingReplyMessageBody is true
    const envelope2 = buildRequestEnvelope({
      intentName: 'AMAZON.FallbackIntent',
      sessionAttributes: res1.sessionAttributes,
      slots: {
        catchAll: { name: 'catchAll', value: 'to akhil jio' }
      }
    });
    const res2 = await skill.invoke(envelope2);
    const speech2 = res2.response.outputSpeech.ssml;
    assert.ok(speech2.includes('What message would you like to send to akhil jio?'));
    assert.strictEqual(res2.sessionAttributes.awaitingReplyMessageBody, true);
    assert.strictEqual(res2.sessionAttributes.activeSenderContext.senderName, 'akhil jio');

    // Step 3: User says the message "hello back"
    const envelope3 = buildRequestEnvelope({
      intentName: 'ReplyMessageIntent',
      sessionAttributes: res2.sessionAttributes,
      slots: {
        replyMessage: { name: 'replyMessage', value: 'hello back' }
      }
    });
    const res3 = await skill.invoke(envelope3);
    const speech3 = res3.response.outputSpeech.ssml;
    assert.ok(speech3.includes('To confirm sending this message to akhil jio on WhatsApp: "hello back"'));
    assert.ok(speech3.includes('four digit secret key'));
  });

  // 47. WhatsApp multi-sender group notification extraction and summary
  test('WhatsApp multi-sender group notification: general read summarizes, sender query extracts exact message', async () => {
    const rawGroupText = `~ Sujith @ (Full) Common Group 1 MTECH-AIML-2026-JULY: New feature: Add to calender Now you can add the event to Google calender and set the notifications and reminder ️. ~ Prince Solomon J @ (Full) Common Group 1 MTECH-AIML-2026-JULY: Sent a sticker. ~ Kumari Neha @ (Full) Common Group 1 MTECH-AIML-2026-JULY: Nothing is showing on mercer mettle Please share the result link. ~ Sarthak Rout @ (Full) Common Group 1 MTECH-AIML-2026-JULY: Sent a sticker. ~ Kumari Neha @ (Full) Common Group 1 MTECH-AIML-2026-JULY: Where we can see our results. (Full) Common Group 1 MTECH-AIML-2026-JULY: Pinned Hey guys, looks like a lot of us are missing the timelines. Put together a quick centralized page so we can easily track what to prioritize right now. What's Now page, bookmark it: a link Akhil Jio: so yep.`;

    notificationService.setMockNotifications([
      {
        id: 'g1',
        notificationKey: 'k-group-1',
        appName: 'WhatsApp',
        title: '(Full) Common Group 1 MTECH-AIML-2026-JULY',
        text: rawGroupText,
        bigText: rawGroupText,
        contentAvailable: true,
        isActive: true,
        postedAt: Date.now() - 10000
      }
    ]);

    // Test A: General read produces a concise group summary
    const envAll = buildRequestEnvelope({ intentName: 'ReadNotificationsIntent' });
    const resAll = await skill.invoke(envAll);
    const speechAll = resAll.response.outputSpeech.ssml;
    assert.ok(speechAll.includes('messages from'));
    assert.ok(speechAll.includes('Akhil Jio') || speechAll.includes('so yep'));

    // Test B: Querying specifically for "akhil jio" extracts their message
    const envSender = buildRequestEnvelope({
      intentName: 'ReadNotificationsBySenderIntent',
      slots: {
        senderName: { name: 'senderName', value: 'akhil jio' }
      }
    });
    const resSender = await skill.invoke(envSender);
    const speechSender = resSender.response.outputSpeech.ssml;
    assert.ok(speechSender.includes('Akhil Jio says: so yep'));
    assert.strictEqual(resSender.sessionAttributes.activeSenderContext.senderName, 'Akhil Jio');
  });

  // 48. Summarizing long single message (> 220 characters) cleanly
  test('Single long notification message is summarized concisely without breaking', async () => {
    const longText = 'Hey team, here is the full comprehensive update for our quarterly planning sprint. We have reviewed all deliverables across modules and determined that phase one will launch next Monday at 9 AM PST. Please confirm your availability for the kickoff call tomorrow morning.';
    notificationService.setMockNotifications([
      {
        id: 'long1',
        notificationKey: 'k-long',
        appName: 'WhatsApp',
        title: 'Project Lead',
        text: longText,
        contentAvailable: true,
        isActive: true,
        postedAt: Date.now() - 5000
      }
    ]);

    const env = buildRequestEnvelope({ intentName: 'ReadNotificationsIntent' });
    const res = await skill.invoke(env);
    const speech = res.response.outputSpeech.ssml;
    assert.ok(speech.includes('Project Lead says:'));
    assert.ok(speech.includes('Hey team, here is the full comprehensive update'));
  });
});



