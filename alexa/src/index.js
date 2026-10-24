/**
 * Amazon Alexa Custom Skill: Phone Reader
 * Implements intent handlers using the Alexa Skills Kit (ASK) SDK.
 */

// Load config if present (e.g., in Alexa-Hosted skills)
try {
  require('./config');
} catch (e) {
  // config.js is optional if environment variables are already set
}

const Alexa = require('ask-sdk-core');
const notificationService = require('./services/notificationService');
const {
  formatSingleNotification,
  getOrdinal,
  formatSummary,
  extractOtp,
  getRelativeTimeString,
  formatSenderResponse,
  formatWhoMessagedSummary,
  formatBatteryResponse,
  formatMissedCallsResponse,
  formatDailyBriefing
} = require('./services/speechFormatter');
const {
  parseReplyUtterance,
  normalizeSpokenDigits,
  classifyOpenUtterance,
  stripConversationalStarters
} = require('./services/naturalLanguageEngine');


/**
 * Handle LaunchRequest: "Alexa, open Phone Reader"
 */
const LaunchRequestHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'LaunchRequest';
  },
  async handle(handlerInput) {
    const speakOutput = 'Welcome to Mobile Reader. You can say: read my notifications, check messages from Mom, what is my OTP, or read my WhatsApp notifications. How can I help?';
    const reprompt = 'You can say: read my notifications, check messages from a contact, or ask for your latest OTP.';

    return handlerInput.responseBuilder
      .speak(speakOutput)
      .reprompt(reprompt)
      .withShouldEndSession(false)
      .getResponse();
  }
};

/**
 * Handle ReadNotificationsIntent: "Alexa, ask Phone Reader to read my notifications"
 */
const ReadNotificationsIntentHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === 'ReadNotificationsIntent';
  },
  async handle(handlerInput) {
    try {
      const notifications = await notificationService.fetchActiveNotifications();

      if (!notifications || notifications.length === 0) {
        return handlerInput.responseBuilder
          .speak("You don't have any active notifications right now.")
          .withShouldEndSession(true)
          .getResponse();
      }

      // Check DND status
      let settings = { dndEnabled: false, priorityApps: ['WhatsApp'] };
      try {
        settings = await notificationService.fetchSettings();
      } catch (e) {
        // Fall back gracefully
      }

      let activeNotifications = notifications;
      let dndPrefix = '';

      if (settings.dndEnabled) {
        const priorityList = (settings.priorityApps || []).map(a => a.toLowerCase().trim());
        activeNotifications = notifications.filter(n => {
          const app = (n.appName || '').toLowerCase();
          const pkg = (n.packageName || '').toLowerCase();
          return priorityList.some(p => app.includes(p) || pkg.includes(p));
        });

        if (activeNotifications.length === 0) {
          const priorityNames = (settings.priorityApps || []).join(', ') || 'priority apps';
          return handlerInput.responseBuilder
            .speak(`Do Not Disturb is on. You don't have any active notifications from your priority apps: ${priorityNames}.`)
            .withShouldEndSession(true)
            .getResponse();
        }

        dndPrefix = 'Do Not Disturb is on. ';
      }

      const total = activeNotifications.length;
      const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
      sessionAttributes.notifications = activeNotifications;
      sessionAttributes.currentIndex = 0;
      sessionAttributes.awaitingReplyPrompt = true;
      sessionAttributes.activeSenderContext = {
        senderName: activeNotifications[0].title || activeNotifications[0].appName || '',
        appName: activeNotifications[0].appName || 'WhatsApp',
        notificationKey: activeNotifications[0].notificationKey || activeNotifications[0].key || ''
      };

      if (total === 1) {
        const itemSpeech = formatSingleNotification(activeNotifications[0], { isLatestOnly: false });
        const speakOutput = `${dndPrefix}You have 1 active notification. ${itemSpeech} Would you like to reply?`;
        sessionAttributes.lastSpoken = speakOutput;
        handlerInput.attributesManager.setSessionAttributes(sessionAttributes);

        return handlerInput.responseBuilder
          .speak(speakOutput)
          .reprompt('Would you like to reply to this message? You can say your message, or no.')
          .withShouldEndSession(false)
          .getResponse();
      }

      // Multiple notifications: start pagination
      const firstSpeech = formatSingleNotification(activeNotifications[0], { prefixOrdinal: 'First' });
      const speakOutput = `${dndPrefix}You have ${total} active notifications. ${firstSpeech} Would you like to hear the next notification, or reply?`;
      const reprompt = 'Say next to hear the next notification, reply to send a message, or stop.';

      sessionAttributes.lastSpoken = firstSpeech;
      handlerInput.attributesManager.setSessionAttributes(sessionAttributes);

      return handlerInput.responseBuilder
        .speak(speakOutput)
        .reprompt(reprompt)
        .withShouldEndSession(false)
        .getResponse();

    } catch (err) {
      return handleServiceError(handlerInput, err);
    }
  }
};

/**
 * Handle ReadLatestNotificationIntent: "Alexa, ask Phone Reader what my latest notification says"
 */
const ReadLatestNotificationIntentHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === 'ReadLatestNotificationIntent';
  },
  async handle(handlerInput) {
    try {
      const latest = await notificationService.fetchLatestNotification();

      if (!latest) {
        return handlerInput.responseBuilder
          .speak("You don't have any active notifications right now.")
          .withShouldEndSession(true)
          .getResponse();
      }

      const itemSpeech = formatSingleNotification(latest, { isLatestOnly: true });
      const speakOutput = `${itemSpeech} Would you like to reply?`;
      const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
      sessionAttributes.notifications = [latest];
      sessionAttributes.currentIndex = 0;
      sessionAttributes.awaitingReplyPrompt = true;
      sessionAttributes.activeSenderContext = {
        senderName: latest.title || latest.appName || '',
        appName: latest.appName || 'WhatsApp',
        notificationKey: latest.notificationKey || latest.key || ''
      };
      sessionAttributes.lastSpoken = speakOutput;
      handlerInput.attributesManager.setSessionAttributes(sessionAttributes);

      return handlerInput.responseBuilder
        .speak(speakOutput)
        .reprompt('Would you like to reply to this message? You can say your message, or say no.')
        .withShouldEndSession(false)
        .getResponse();

    } catch (err) {
      return handleServiceError(handlerInput, err);
    }
  }
};

/**
 * Handle ReadNotificationsByAppIntent: "Alexa, ask Phone Reader to read my WhatsApp notifications"
 */
const ReadNotificationsByAppIntentHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === 'ReadNotificationsByAppIntent';
  },
  async handle(handlerInput) {
    const slot = Alexa.getSlot(handlerInput.requestEnvelope, 'appName');
    const rawVal = slot && slot.value ? slot.value.trim() : '';

    // Check if user was actually speaking a reply or send command that got routed here!
    const parsedReply = parseReplyUtterance(rawVal);
    if (parsedReply && parsedReply.isReply && parsedReply.message) {
      handlerInput.requestEnvelope.request.intent = {
        name: 'ReplyMessageIntent',
        slots: {
          senderName: { name: 'senderName', value: parsedReply.recipient },
          appName: { name: 'appName', value: parsedReply.app },
          replyMessage: { name: 'replyMessage', value: parsedReply.message }
        }
      };
      return ReplyMessageIntentHandler.handle(handlerInput);
    }

    let appName = rawVal;

    // Clean conversational artifacts from appName if captured during invocation
    if (appName) {
      if (slot.resolutions && slot.resolutions.resolutionsPerAuthority) {
        for (const auth of slot.resolutions.resolutionsPerAuthority) {
          if (auth.status && auth.status.code === 'ER_SUCCESS_MATCH' && auth.values && auth.values.length > 0) {
            appName = auth.values[0].value.name;
            break;
          }
        }
      }
      if (/instagram/i.test(appName)) appName = 'Instagram';
      else if (/whatsapp/i.test(appName)) appName = 'WhatsApp';
      else if (/gmail/i.test(appName)) appName = 'Gmail';
      else if (/telegram/i.test(appName)) appName = 'Telegram';
      else if (/(?:messages|sms|text)/i.test(appName)) appName = 'Messages';
    }

    if (!appName) {
      return handlerInput.responseBuilder
        .speak('Which app notifications would you like me to check? You can say WhatsApp, Instagram, or Gmail.')
        .reprompt('Which app would you like me to check?')
        .withShouldEndSession(false)
        .getResponse();
    }

    try {
      const notifications = await notificationService.fetchActiveNotifications({ appFilter: appName });

      if (!notifications || notifications.length === 0) {
        // Smart suggestion: check if phone has active notifications from other apps
        let otherAppsSummary = '';
        try {
          const allActive = await notificationService.fetchActiveNotifications({ limit: 5 });
          if (allActive && allActive.length > 0) {
            const distinctApps = Array.from(new Set(allActive.map(n => n.appName || 'Unknown'))).slice(0, 3);
            otherAppsSummary = distinctApps.join(' and ');
          }
        } catch (e) {
          // Non-blocking
        }

        if (otherAppsSummary) {
          return handlerInput.responseBuilder
            .speak(`You don't have any active notifications from ${appName} right now. But you have notifications from ${otherAppsSummary}. You can say: read my notifications, or ask for another app.`)
            .reprompt('You can say: read my notifications, or ask for another app.')
            .withShouldEndSession(false)
            .getResponse();
        }

        return handlerInput.responseBuilder
          .speak(`You don't have any active notifications from ${appName} right now.`)
          .withShouldEndSession(true)
          .getResponse();
      }

      const total = notifications.length;
      const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
      sessionAttributes.notifications = notifications;
      sessionAttributes.currentIndex = 0;
      sessionAttributes.appFilter = appName;
      sessionAttributes.awaitingReplyPrompt = true;
      sessionAttributes.activeSenderContext = {
        senderName: notifications[0].title || notifications[0].appName || '',
        appName: notifications[0].appName || appName || 'WhatsApp',
        notificationKey: notifications[0].notificationKey || notifications[0].key || ''
      };

      if (total === 1) {
        const itemSpeech = formatSingleNotification(notifications[0], { isLatestOnly: false });
        const speakOutput = `You have 1 notification from ${appName}. ${itemSpeech} Would you like to reply?`;
        sessionAttributes.lastSpoken = speakOutput;
        handlerInput.attributesManager.setSessionAttributes(sessionAttributes);

        return handlerInput.responseBuilder
          .speak(speakOutput)
          .reprompt('Would you like to reply to this message? You can say your message, or no.')
          .withShouldEndSession(false)
          .getResponse();
      }

      const firstSpeech = formatSingleNotification(notifications[0], { prefixOrdinal: 'First' });
      const speakOutput = `You have ${total} notifications from ${appName}. ${firstSpeech} Would you like to hear the next notification, or reply?`;
      const reprompt = 'Say next to hear the next notification, reply to send a message, or stop.';

      sessionAttributes.lastSpoken = firstSpeech;
      handlerInput.attributesManager.setSessionAttributes(sessionAttributes);

      return handlerInput.responseBuilder
        .speak(speakOutput)
        .reprompt(reprompt)
        .withShouldEndSession(false)
        .getResponse();

    } catch (err) {
      return handleServiceError(handlerInput, err);
    }
  }
};

/**
 * Handle ReadNotificationsBySenderIntent: "Alexa, ask Phone Reader: did Mom text me?"
 */
const ReadNotificationsBySenderIntentHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === 'ReadNotificationsBySenderIntent';
  },
  async handle(handlerInput) {
    const slot = Alexa.getSlot(handlerInput.requestEnvelope, 'senderName');
    const appSlot = Alexa.getSlot(handlerInput.requestEnvelope, 'appName');
    let senderName = slot && slot.value ? slot.value.trim() : '';
    let appName = appSlot && appSlot.value ? appSlot.value.trim() : '';

    // Check if user was actually speaking a reply or send command that got routed here!
    const parsedReply = parseReplyUtterance(senderName);
    if (parsedReply && parsedReply.isReply && parsedReply.message) {
      handlerInput.requestEnvelope.request.intent = {
        name: 'ReplyMessageIntent',
        slots: {
          senderName: { name: 'senderName', value: parsedReply.recipient },
          appName: { name: 'appName', value: parsedReply.app },
          replyMessage: { name: 'replyMessage', value: parsedReply.message }
        }
      };
      return ReplyMessageIntentHandler.handle(handlerInput);
    }

    // Extract app if mentioned inside senderName slot (e.g. "akhil jio on whatsapp", "whatsapp notifications from akhil jio")
    const appMatch = senderName.match(/\b(?:on|in|via|from)\s+(WhatsApp|Instagram|Insta|IG|Gmail|Telegram|Messages|SMS)\b/i) ||
                     senderName.match(/\b(WhatsApp|Instagram|Insta|IG|Gmail|Telegram|Messages|SMS)\s+(?:notifications?|messages?|chats?)\b/i);
    if (appMatch) {
      if (!appName) appName = appMatch[1];
      senderName = senderName.replace(appMatch[0], ' ').trim();
    }

    if (appName) {
      if (/instagram|insta|ig/i.test(appName)) appName = 'Instagram';
      else if (/whatsapp|wa/i.test(appName)) appName = 'WhatsApp';
      else if (/gmail|mail/i.test(appName)) appName = 'Gmail';
      else if (/telegram/i.test(appName)) appName = 'Telegram';
      else if (/(?:messages|sms)/i.test(appName)) appName = 'Messages';
    }

    // Clean carrier and noise words from senderName (e.g. "akhil jio contact" -> "akhil jio")
    senderName = senderName
      .replace(/\b(?:from|contact|contacts|notifications?|noptifications?|messages?|chats?|dm|dms|latest)\b/gi, ' ')
      .replace(/^[\\\/.,;:\s]+|[\\\/.,;:\s]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!senderName && appName) {
      handlerInput.requestEnvelope.request.intent = {
        name: 'ReadNotificationsByAppIntent',
        slots: { appName: { name: 'appName', value: appName } }
      };
      return ReadNotificationsByAppIntentHandler.handle(handlerInput);
    }

    if (!senderName) {
      return handlerInput.responseBuilder
        .speak('Whose messages would you like me to check? You can ask about any contact, person, or Instagram username.')
        .reprompt('Whose messages would you like me to check?')
        .withShouldEndSession(false)
        .getResponse();
    }

    try {
      const notifications = await notificationService.fetchNotificationsBySender({ senderName, appFilter: appName });

      if (!notifications || notifications.length === 0) {
        let otherActive = [];
        try {
          otherActive = await notificationService.fetchActiveNotifications({ limit: 5 });
        } catch (e) {}

        const res = formatSenderResponse({ notifications: [], senderName, otherActive });
        if (res.hasOther) {
          const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
          sessionAttributes.notifications = otherActive;
          sessionAttributes.currentIndex = -1;
          sessionAttributes.awaitingReadOtherPrompt = true;
          handlerInput.attributesManager.setSessionAttributes(sessionAttributes);

          return handlerInput.responseBuilder
            .speak(res.speech)
            .reprompt('Would you like to hear your other notifications? Say yes or no.')
            .withShouldEndSession(false)
            .getResponse();
        }

        return handlerInput.responseBuilder
          .speak(res.speech)
          .withShouldEndSession(true)
          .getResponse();
      }

      const total = notifications.length;
      const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
      sessionAttributes.notifications = notifications;
      sessionAttributes.currentIndex = 0;
      sessionAttributes.senderFilter = senderName;
      sessionAttributes.awaitingReplyPrompt = true;

      const formatted = formatSenderResponse({ notifications, senderName });
      sessionAttributes.lastSpoken = formatted.speech;

      const effectiveSender = formatted.sender || senderName || notifications[0].title || '';
      const effectiveApp = formatted.appName || appName || notifications[0].appName || 'WhatsApp';
      sessionAttributes.activeSenderContext = {
        senderName: effectiveSender,
        appName: effectiveApp,
        notificationKey: notifications[0].notificationKey || notifications[0].key || ''
      };
      handlerInput.attributesManager.setSessionAttributes(sessionAttributes);

      if (total === 1) {
        const speakOutput = `${formatted.speech} Would you like to reply?`;
        return handlerInput.responseBuilder
          .speak(speakOutput)
          .reprompt('Would you like to reply? Say your message, or say no.')
          .withShouldEndSession(false)
          .getResponse();
      }

      const speakOutput = `${formatted.speech} Would you like to hear the next message, or reply?`;
      return handlerInput.responseBuilder
        .speak(speakOutput)
        .reprompt('Say next to hear the next message, reply to send a message, or stop.')
        .withShouldEndSession(false)
        .getResponse();

    } catch (err) {
      return handleServiceError(handlerInput, err);
    }
  }
};

/**
 * Handle WhoMessagedMeIntent: "Alexa, ask Phone Reader: who messaged me?"
 */
const WhoMessagedMeIntentHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === 'WhoMessagedMeIntent';
  },
  async handle(handlerInput) {
    try {
      const notifications = await notificationService.fetchActiveNotifications({ limit: 20 });
      const speakOutput = formatWhoMessagedSummary(notifications);

      if (!notifications || notifications.length === 0) {
        return handlerInput.responseBuilder
          .speak(speakOutput)
          .withShouldEndSession(true)
          .getResponse();
      }

      const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
      sessionAttributes.notifications = notifications;
      sessionAttributes.currentIndex = -1;
      handlerInput.attributesManager.setSessionAttributes(sessionAttributes);

      return handlerInput.responseBuilder
        .speak(speakOutput)
        .reprompt('Would you like me to read your notifications? Say yes or no.')
        .withShouldEndSession(false)
        .getResponse();

    } catch (err) {
      return handleServiceError(handlerInput, err);
    }
  }
};

/**
 * Handle ReadOtpIntent: "Alexa, ask Phone Reader: what is my OTP?"
 */
const ReadOtpIntentHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === 'ReadOtpIntent';
  },
  async handle(handlerInput) {
    try {
      const notifications = await notificationService.fetchActiveNotifications({ limit: 30 });
      const otp = extractOtp(notifications);

      if (!otp) {
        return handlerInput.responseBuilder
          .speak("You haven't received any OTP or verification codes recently. You can say: read my notifications, to check all incoming messages.")
          .withShouldEndSession(true)
          .getResponse();
      }

      const timePhrase = otp.relativeTime ? `, received ${otp.relativeTime}` : '';
      const speakOutput = `Your OTP from ${otp.sender} is <say-as interpret-as="digits">${otp.code}</say-as>${timePhrase}. The message says: ${otp.rawBody}.`;

      return handlerInput.responseBuilder
        .speak(speakOutput)
        .withShouldEndSession(true)
        .getResponse();

    } catch (err) {
      return handleServiceError(handlerInput, err);
    }
  }
};

/**
 * Handle CheckPhoneStatusIntent: "Alexa, ask Phone Reader: how is my phone?"
 */
const CheckPhoneStatusIntentHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === 'CheckPhoneStatusIntent';
  },
  async handle(handlerInput) {
    try {
      const status = await notificationService.fetchPhoneStatus();
      const relTime = status.lastSyncTime ? getRelativeTimeString(status.lastSyncTime) : 'never';
      const activeCount = status.activeCount || 0;
      const countPhrase = activeCount === 1 ? '1 active notification' : `${activeCount} active notifications`;

      if (status.isHealthy) {
        const speakOutput = `Your phone is connected and active. The last sync was ${relTime}, and you have ${countPhrase}.`;
        return handlerInput.responseBuilder
          .speak(speakOutput)
          .withShouldEndSession(true)
          .getResponse();
      }

      const speakOutput = status.lastSyncTime > 0
        ? `Your phone last synced ${relTime}. It might be sleeping or disconnected. Please verify that battery optimization is disabled for Mobile Reader on your phone.`
        : 'Your phone has not synced yet. Please open the Mobile Reader app on your phone and ensure the notification listener is enabled.';

      return handlerInput.responseBuilder
        .speak(speakOutput)
        .withShouldEndSession(true)
        .getResponse();

    } catch (err) {
      return handleServiceError(handlerInput, err);
    }
  }
};

/**
 * Handle ClearNotificationsByAppIntent: "Alexa, ask Phone Reader to clear WhatsApp notifications"
 */
const ClearNotificationsByAppIntentHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === 'ClearNotificationsByAppIntent';
  },
  async handle(handlerInput) {
    const slot = Alexa.getSlot(handlerInput.requestEnvelope, 'appName');
    const appName = slot && slot.value ? slot.value.trim() : '';

    if (!appName) {
      return handlerInput.responseBuilder
        .speak('Which app notifications would you like me to clear? You can say WhatsApp or Instagram.')
        .reprompt('Which app would you like to clear?')
        .withShouldEndSession(false)
        .getResponse();
    }

    try {
      await notificationService.clearNotifications({ appFilter: appName });
      return handlerInput.responseBuilder
        .speak(`Your ${appName} notifications have been cleared.`)
        .withShouldEndSession(true)
        .getResponse();
    } catch (err) {
      return handleServiceError(handlerInput, err);
    }
  }
};

/**
 * Handle ReplyMessageIntent: Initiates voice/text reply (STRICTLY PIN-PROTECTED).
 * "Alexa, ask Phone Reader to reply to Mom: I will be there in 10 minutes"
 */
const ReplyMessageIntentHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === 'ReplyMessageIntent';
  },
  async handle(handlerInput) {
    const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
    const activeCtx = sessionAttributes.activeSenderContext || {};
    let notificationKey = (activeCtx && activeCtx.notificationKey) ||
      (sessionAttributes.notifications && sessionAttributes.currentIndex >= 0 && (sessionAttributes.notifications[sessionAttributes.currentIndex].notificationKey || sessionAttributes.notifications[sessionAttributes.currentIndex].key)) || '';

    const context = {
      activeSender: activeCtx.senderName || sessionAttributes.senderFilter || '',
      activeApp: activeCtx.appName || sessionAttributes.appFilter || 'WhatsApp',
      notificationKey,
      lastNotification: (sessionAttributes.notifications && sessionAttributes.currentIndex >= 0)
        ? sessionAttributes.notifications[sessionAttributes.currentIndex]
        : null
    };

    const senderSlot = Alexa.getSlot(handlerInput.requestEnvelope, 'senderName');
    const appSlot = Alexa.getSlot(handlerInput.requestEnvelope, 'appName');
    const msgSlot = Alexa.getSlot(handlerInput.requestEnvelope, 'replyMessage');

    let rawSender = senderSlot && senderSlot.value ? senderSlot.value.trim() : '';
    let rawApp = appSlot && appSlot.value ? appSlot.value.trim() : '';
    let rawMsg = msgSlot && msgSlot.value ? msgSlot.value.trim() : '';

    // Discard placeholder nouns from rawSender
    if (/^(?:a\s+|the\s+|this\s+|that\s+)?(?:message|text|notification|contact|chat|person|someone|anyone|something|voice\s*note)$/i.test(rawSender)) {
      rawSender = '';
    }
    rawSender = rawSender.replace(/^(?:to|for)\s+/i, '').trim();

    // If awaiting reply body after prompt
    if (sessionAttributes.awaitingReplyMessageBody) {
      delete sessionAttributes.awaitingReplyMessageBody;

      // Check if user was actually specifying/changing the contact name (e.g. "to akhil jio")
      const candidateClarification = rawSender || rawMsg || '';
      const toRecipientMatch = candidateClarification.match(/^(?:to|for)\s+([a-zA-Z0-9_@]+(?:\s+[a-zA-Z0-9_@]+){0,2})(?:\s+(?:on|in|via)\s+([a-zA-Z0-9_@]+))?$/i);
      if (toRecipientMatch) {
        rawSender = toRecipientMatch[1].trim();
        if (toRecipientMatch[2]) rawApp = toRecipientMatch[2].trim();
        rawMsg = '';
      } else {
        if (!rawMsg) {
          rawMsg = rawSender || rawApp || '';
        }
        rawMsg = rawMsg.replace(/^(?:reply\s+(?:with|saying|that)?|saying|that|with)\s*/i, '').trim();
      }
    }

    if (sessionAttributes.awaitingReplyRecipient) {
      delete sessionAttributes.awaitingReplyRecipient;
      if (!rawSender) {
        rawSender = (rawMsg || '').replace(/^(?:to|for)\s+/i, '').trim();
        rawMsg = '';
      }
    }

    // Check if slots together form a compound phrase, or if rawMsg is a full utterance
    const candidateUtterance = [rawSender, rawMsg].filter(Boolean).join(' ');
    const parsed = parseReplyUtterance(candidateUtterance, context) || parseReplyUtterance(rawMsg, context);

    let senderName = rawSender;
    let appName = rawApp || context.activeApp || 'WhatsApp';
    let replyMessage = rawMsg;

    if (parsed) {
      senderName = parsed.recipient || senderName;
      appName = parsed.app || appName;
      replyMessage = parsed.message || replyMessage;
    } else {
      // Resolve pronouns ("her", "him", "them", "everyone")
      const isPronoun = /^(?:her|him|them|everyone|all)$/i.test(senderName);
      if (isPronoun || !senderName) {
        senderName = context.activeSender;
      }
      // Clean connectors
      replyMessage = replyMessage.replace(/^(?:[:\-]|that|saying|with|to\s+say)\s*/i, '').trim();
    }

    if (/^(?:a\s+|the\s+|this\s+|that\s+)?(?:message|text|notification|contact|chat|person|someone|anyone|something|voice\s*note)$/i.test(senderName)) {
      senderName = '';
    }

    // If senderName and context are still empty, fetch latest notification from backend dynamically!
    if (!senderName && !context.activeSender) {
      try {
        const latest = await notificationService.fetchLatestNotification({ appFilter: rawApp || '' });
        if (latest) {
          senderName = latest.title || '';
          appName = latest.appName || appName;
          notificationKey = latest.notificationKey || latest.key || notificationKey;
        }
      } catch (e) {
        // non-blocking
      }
    }

    const targetContact = senderName || context.activeSender || '';
    const cleanApp = appName || context.activeApp || 'WhatsApp';

    if (!targetContact) {
      sessionAttributes.awaitingReplyRecipient = true;
      sessionAttributes.awaitingReplyMessageBody = true;
      handlerInput.attributesManager.setSessionAttributes(sessionAttributes);
      return handlerInput.responseBuilder
        .speak('Who would you like to reply to? You can say: to Akhil Jio, or to Mom on WhatsApp.')
        .reprompt('Who would you like to reply to?')
        .withShouldEndSession(false)
        .getResponse();
    }

    if (!replyMessage) {
      sessionAttributes.awaitingReplyMessageBody = true;
      sessionAttributes.activeSenderContext = {
        senderName: targetContact,
        appName: cleanApp,
        notificationKey
      };
      handlerInput.attributesManager.setSessionAttributes(sessionAttributes);

      return handlerInput.responseBuilder
        .speak(`What message would you like to send to ${targetContact}?`)
        .reprompt(`What message would you like to send to ${targetContact}?`)
        .withShouldEndSession(false)
        .getResponse();
    }

    // Save pending reply state in session attributes - MUST INCLUDE notificationKey!
    sessionAttributes.awaitingSecretPinForReply = {
      senderName: targetContact || 'your contact',
      appName: cleanApp,
      notificationKey: notificationKey || '',
      replyMessage
    };
    delete sessionAttributes.awaitingReplyPrompt;
    delete sessionAttributes.awaitingReplyMessageBody;
    handlerInput.attributesManager.setSessionAttributes(sessionAttributes);

    let recipientDescription = '';
    if (targetContact) {
      recipientDescription = `${targetContact} on ${cleanApp}`;
    } else {
      recipientDescription = `your contact on ${cleanApp}`;
    }

    const speakOutput = `To confirm sending this message to ${recipientDescription}: "${replyMessage}". Please say your four digit secret key.`;
    const reprompt = 'Please say your four digit secret key to confirm sending this message.';

    return handlerInput.responseBuilder
      .speak(speakOutput)
      .reprompt(reprompt)
      .withShouldEndSession(false)
      .getResponse();
  }
};

/**
 * Handle ConfirmSecretPinIntent: Authorizes and sends pending reply ONLY if PIN matches.
 * "secret key is 4826", "pin is 4826", "4826", "four eight two six"
 */
const ConfirmSecretPinIntentHandler = {
  canHandle(handlerInput) {
    const isPinIntent = Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === 'ConfirmSecretPinIntent';

    const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
    const hasPendingReply = Boolean(sessionAttributes && sessionAttributes.awaitingSecretPinForReply);

    return isPinIntent || (hasPendingReply && Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest');
  },
  async handle(handlerInput) {
    const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
    const pending = sessionAttributes.awaitingSecretPinForReply;

    if (!pending) {
      return handlerInput.responseBuilder
        .speak('There is no pending message to confirm. You can say: reply to Mom, or read my notifications.')
        .withShouldEndSession(true)
        .getResponse();
    }

    const pinSlot = Alexa.getSlot(handlerInput.requestEnvelope, 'secretPin');
    let rawPin = pinSlot && pinSlot.value ? pinSlot.value : '';

    if (!rawPin) {
      // Fallback: check if any slot contains words or digits
      const slots = (handlerInput.requestEnvelope.request.intent && handlerInput.requestEnvelope.request.intent.slots) || {};
      for (const s of Object.values(slots)) {
        if (s && s.value) {
          rawPin = s.value;
          break;
        }
      }
    }

    // Intelligent spoken digit normalization (e.g. "four eight two six" -> "4826")
    let candidateKey = normalizeSpokenDigits(rawPin);
    if (!candidateKey) {
      candidateKey = rawPin.replace(/[\s-]/g, '').trim();
    }

    try {
      const isVerified = await notificationService.verifySecretKey(candidateKey);
      if (!isVerified) {
        // Clear pending reply immediately for security
        delete sessionAttributes.awaitingSecretPinForReply;
        handlerInput.attributesManager.setSessionAttributes(sessionAttributes);

        return handlerInput.responseBuilder
          .speak('Incorrect secret key. For your security, the message was cancelled and was not sent.')
          .withShouldEndSession(true)
          .getResponse();
      }

      // Secret key verified! Send reply through device action queue
      await notificationService.sendReplyMessage({
        secretKey: candidateKey,
        senderName: pending.senderName,
        appName: pending.appName,
        notificationKey: pending.notificationKey || '',
        replyText: pending.replyMessage
      });

      delete sessionAttributes.awaitingSecretPinForReply;
      handlerInput.attributesManager.setSessionAttributes(sessionAttributes);

      const target = pending.senderName || pending.appName || 'your contact';
      const speakOutput = `Secret key verified. Your message has been sent to ${target}: "${pending.replyMessage}".`;

      return handlerInput.responseBuilder
        .speak(speakOutput)
        .withShouldEndSession(true)
        .getResponse();

    } catch (err) {
      delete sessionAttributes.awaitingSecretPinForReply;
      handlerInput.attributesManager.setSessionAttributes(sessionAttributes);

      if (err.message === 'INCORRECT_SECRET_KEY') {
        return handlerInput.responseBuilder
          .speak('Incorrect secret key. For your security, the message was cancelled and was not sent.')
          .withShouldEndSession(true)
          .getResponse();
      }

      return handleServiceError(handlerInput, err);
    }
  }
};

/**
 * Handle ChangeSecretKeyIntent: Updates user secret key.
 * "Alexa, ask Phone Reader to change secret key from 4826 to 9999"
 */
const ChangeSecretKeyIntentHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === 'ChangeSecretKeyIntent';
  },
  async handle(handlerInput) {
    const oldSlot = Alexa.getSlot(handlerInput.requestEnvelope, 'oldPin');
    const newSlot = Alexa.getSlot(handlerInput.requestEnvelope, 'newPin');

    const oldPin = normalizeSpokenDigits(oldSlot && oldSlot.value ? oldSlot.value : '') || (oldSlot && oldSlot.value ? oldSlot.value.replace(/[\s-]/g, '').trim() : '');
    const newPin = normalizeSpokenDigits(newSlot && newSlot.value ? newSlot.value : '') || (newSlot && newSlot.value ? newSlot.value.replace(/[\s-]/g, '').trim() : '');

    if (!oldPin || !newPin) {
      return handlerInput.responseBuilder
        .speak('To change your secret key, please say: change secret key from [your current key] to [your new key].')
        .reprompt('Please say: change secret key from old key to new key.')
        .withShouldEndSession(false)
        .getResponse();
    }

    try {
      const res = await notificationService.changeSecretKey(oldPin, newPin);
      if (!res.success) {
        return handlerInput.responseBuilder
          .speak('Your current secret key was incorrect. Secret key was not changed.')
          .withShouldEndSession(true)
          .getResponse();
      }

      const spacedNewPin = newPin.split('').join(' ');
      return handlerInput.responseBuilder
        .speak(`Your secret key has been successfully updated to <say-as interpret-as="digits">${spacedNewPin}</say-as>. Make sure to remember this new key for sending messages.`)
        .withShouldEndSession(true)
        .getResponse();

    } catch (err) {
      return handleServiceError(handlerInput, err);
    }
  }
};

/**
 * Handle CheckBatteryIntent: "Alexa, ask Phone Reader: what is my battery level?"
 */
const CheckBatteryIntentHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === 'CheckBatteryIntent';
  },
  async handle(handlerInput) {
    try {
      const status = await notificationService.fetchPhoneStatus();
      const speakOutput = formatBatteryResponse(status);

      return handlerInput.responseBuilder
        .speak(speakOutput)
        .withShouldEndSession(true)
        .getResponse();
    } catch (err) {
      return handleServiceError(handlerInput, err);
    }
  }
};

/**
 * Handle FindMyPhoneIntent: "Alexa, ask Phone Reader to ring my phone"
 */
const FindMyPhoneIntentHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === 'FindMyPhoneIntent';
  },
  async handle(handlerInput) {
    const rawUtterance = (handlerInput.requestEnvelope.request.intent && handlerInput.requestEnvelope.request.intent.name) || '';
    // Check if user requested to stop ringing
    const isStop = rawUtterance.includes('stop') || rawUtterance.includes('silence');

    try {
      if (isStop) {
        await notificationService.triggerFindMyPhone(false);
        return handlerInput.responseBuilder
          .speak('I have sent a command to stop ringing your phone.')
          .withShouldEndSession(true)
          .getResponse();
      }

      await notificationService.triggerFindMyPhone(true);
      return handlerInput.responseBuilder
        .speak('Ringing your phone at maximum volume now. Tap your phone screen to stop the ringer, or say: stop ringing my phone.')
        .withShouldEndSession(true)
        .getResponse();
    } catch (err) {
      return handleServiceError(handlerInput, err);
    }
  }
};

/**
 * Handle DismissFromPhoneIntent: "Alexa, ask Phone Reader to dismiss WhatsApp from my phone"
 */
const DismissFromPhoneIntentHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === 'DismissFromPhoneIntent';
  },
  async handle(handlerInput) {
    const slot = Alexa.getSlot(handlerInput.requestEnvelope, 'appName');
    const appName = slot && slot.value ? slot.value.trim() : '';

    try {
      await notificationService.dismissPhoneNotifications({
        appName,
        all: !appName
      });

      const target = appName ? `${appName} notifications` : 'all notifications';
      return handlerInput.responseBuilder
        .speak(`I have cleared ${target} directly from your phone's notification bar.`)
        .withShouldEndSession(true)
        .getResponse();
    } catch (err) {
      return handleServiceError(handlerInput, err);
    }
  }
};

/**
 * Handle CheckMissedCallsIntent: "Alexa, ask Phone Reader: did anyone call me?"
 */
const CheckMissedCallsIntentHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === 'CheckMissedCallsIntent';
  },
  async handle(handlerInput) {
    try {
      const calls = await notificationService.fetchMissedCalls();
      const speakOutput = formatMissedCallsResponse(calls);

      return handlerInput.responseBuilder
        .speak(speakOutput)
        .withShouldEndSession(true)
        .getResponse();
    } catch (err) {
      return handleServiceError(handlerInput, err);
    }
  }
};

/**
 * Handle VipContactsIntent: "Alexa, ask Phone Reader to add Mom to VIP"
 */
const VipContactsIntentHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === 'VipContactsIntent';
  },
  async handle(handlerInput) {
    const contactSlot = Alexa.getSlot(handlerInput.requestEnvelope, 'contactName');
    const contactName = contactSlot && contactSlot.value ? contactSlot.value.trim() : '';

    try {
      const current = await notificationService.fetchSettings();
      const vipContacts = current.vipContacts || ['Mom', 'Dad'];

      if (!contactName) {
        const listText = vipContacts.length > 0 ? vipContacts.join(', and ') : 'no contacts';
        return handlerInput.responseBuilder
          .speak(`Your V.I.P. contacts are: ${listText}. Messages from these contacts will always be prioritized.`)
          .withShouldEndSession(true)
          .getResponse();
      }

      if (!vipContacts.includes(contactName)) {
        vipContacts.push(contactName);
        await notificationService.updateSettings({ vipContacts });
        return handlerInput.responseBuilder
          .speak(`${contactName} has been added to your V.I.P. contacts list.`)
          .withShouldEndSession(true)
          .getResponse();
      }

      return handlerInput.responseBuilder
        .speak(`${contactName} is already on your V.I.P. contacts list.`)
        .withShouldEndSession(true)
        .getResponse();

    } catch (err) {
      return handleServiceError(handlerInput, err);
    }
  }
};

/**
 * Handle DailyBriefingIntent: "Alexa, ask Phone Reader for my daily briefing"
 */
const DailyBriefingIntentHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === 'DailyBriefingIntent';
  },
  async handle(handlerInput) {
    try {
      const briefing = await notificationService.fetchDailyBriefing();
      const speakOutput = formatDailyBriefing(briefing);

      if (briefing.totalActiveNotifications === 0) {
        return handlerInput.responseBuilder
          .speak(speakOutput)
          .withShouldEndSession(true)
          .getResponse();
      }

      const active = await notificationService.fetchActiveNotifications({ limit: 10 });
      const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
      sessionAttributes.notifications = active;
      sessionAttributes.currentIndex = -1;
      handlerInput.attributesManager.setSessionAttributes(sessionAttributes);

      return handlerInput.responseBuilder
        .speak(speakOutput)
        .reprompt('Would you like me to read your notifications? Say yes or no.')
        .withShouldEndSession(false)
        .getResponse();

    } catch (err) {
      return handleServiceError(handlerInput, err);
    }
  }
};


/**
 * Handle AMAZON.YesIntent: Context-aware follow-up affirmative handler.
 * Intelligently routes depending on what Alexa asked:
 * - Awaiting clear confirmation -> clears notifications
 * - Awaiting reply to message -> asks "What message would you like to send?"
 * - Awaiting read other notifications -> reads other active notifications
 * - Pagination active -> advances to next notification
 * - General confirmation -> prompts without abruptly ending session
 */
const YesIntentHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.YesIntent';
  },
  async handle(handlerInput) {
    const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();

    // 1. If user is confirming whether to clear notifications after reading them all
    if (sessionAttributes.awaitingClearConfirmation) {
      try {
        await notificationService.clearNotifications({ appFilter: sessionAttributes.appFilter || '' });
        sessionAttributes.awaitingClearConfirmation = false;
        handlerInput.attributesManager.setSessionAttributes(sessionAttributes);
        return handlerInput.responseBuilder
          .speak('Your notifications have been cleared.')
          .withShouldEndSession(true)
          .getResponse();
      } catch (e) {
        return handlerInput.responseBuilder
          .speak('I could not clear your notifications right now.')
          .withShouldEndSession(true)
          .getResponse();
      }
    }

    // 2. If user is answering "Would you like to hear your other notifications?"
    if (sessionAttributes.awaitingReadOtherPrompt) {
      delete sessionAttributes.awaitingReadOtherPrompt;
      const notifications = sessionAttributes.notifications || [];
      if (notifications.length > 0) {
        sessionAttributes.currentIndex = 0;
        sessionAttributes.awaitingReplyPrompt = true;
        sessionAttributes.activeSenderContext = {
          senderName: notifications[0].title || notifications[0].appName || '',
          appName: notifications[0].appName || 'WhatsApp',
          notificationKey: notifications[0].notificationKey || notifications[0].key || ''
        };
        handlerInput.attributesManager.setSessionAttributes(sessionAttributes);

        const itemSpeech = formatSingleNotification(notifications[0], { prefixOrdinal: 'First' });
        const speakOutput = `${itemSpeech} Would you like to hear the next notification, or reply?`;
        return handlerInput.responseBuilder
          .speak(speakOutput)
          .reprompt('Say next to continue, reply to send a message, or stop.')
          .withShouldEndSession(false)
          .getResponse();
      }
    }

    // 3. If user is answering "Would you like to reply?"
    if (sessionAttributes.awaitingReplyPrompt) {
      delete sessionAttributes.awaitingReplyPrompt;
      sessionAttributes.awaitingReplyMessageBody = true;
      handlerInput.attributesManager.setSessionAttributes(sessionAttributes);

      const target = (sessionAttributes.activeSenderContext && sessionAttributes.activeSenderContext.senderName) || 'them';
      const speakOutput = `What message would you like to send to ${target}?`;
      const reprompt = 'What message would you like to reply with? You can say your message, or say stop.';

      return handlerInput.responseBuilder
        .speak(speakOutput)
        .reprompt(reprompt)
        .withShouldEndSession(false)
        .getResponse();
    }

    // 4. Pagination: if more notifications exist, advance
    const notifications = sessionAttributes.notifications || [];
    const currentIndex = sessionAttributes.currentIndex !== undefined ? sessionAttributes.currentIndex : -1;
    const nextIndex = currentIndex + 1;

    if (notifications.length > 0 && nextIndex < notifications.length) {
      return ReadNextNotificationIntentHandler.handle(handlerInput);
    }

    // 5. Fallback: prompt for options without abruptly closing
    const target = (sessionAttributes.activeSenderContext && sessionAttributes.activeSenderContext.senderName) || '';
    const speakOutput = target
      ? `Would you like to reply to ${target}? Say reply to send a message, or say stop.`
      : 'You can say: read my notifications, reply, or stop. What would you like to do?';

    return handlerInput.responseBuilder
      .speak(speakOutput)
      .reprompt('Say read my notifications, reply, or stop.')
      .withShouldEndSession(false)
      .getResponse();
  }
};

/**
 * Handle ReadNextNotificationIntent (Pagination & Next Notification)
 */
const ReadNextNotificationIntentHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === 'ReadNextNotificationIntent';
  },
  async handle(handlerInput) {
    const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();

    const notifications = sessionAttributes.notifications || [];
    const currentIndex = sessionAttributes.currentIndex !== undefined ? sessionAttributes.currentIndex : -1;
    const nextIndex = currentIndex + 1;

    if (notifications.length === 0 || nextIndex >= notifications.length) {
      return handlerInput.responseBuilder
        .speak('That was your last notification.')
        .withShouldEndSession(true)
        .getResponse();
    }

    const nextItem = notifications[nextIndex];
    const isLast = (nextIndex === notifications.length - 1);
    const ordinal = getOrdinal(nextIndex);
    const itemSpeech = formatSingleNotification(nextItem, { prefixOrdinal: ordinal });

    sessionAttributes.currentIndex = nextIndex;
    sessionAttributes.lastSpoken = itemSpeech;
    sessionAttributes.awaitingReplyPrompt = true;
    sessionAttributes.activeSenderContext = {
      senderName: nextItem.title || nextItem.appName || '',
      appName: nextItem.appName || 'WhatsApp',
      notificationKey: nextItem.notificationKey || nextItem.key || ''
    };

    if (isLast) {
      sessionAttributes.awaitingClearConfirmation = true;
      handlerInput.attributesManager.setSessionAttributes(sessionAttributes);
      const speakOutput = `${itemSpeech} That was your last notification. Would you like to reply, or clear these notifications?`;
      const reprompt = 'Would you like to reply, or clear your notifications? Say reply, yes to clear, or stop.';
      return handlerInput.responseBuilder
        .speak(speakOutput)
        .reprompt(reprompt)
        .withShouldEndSession(false)
        .getResponse();
    }

    handlerInput.attributesManager.setSessionAttributes(sessionAttributes);
    const speakOutput = `${itemSpeech} Would you like to hear the next one, or reply?`;
    const reprompt = 'Say next to continue, reply to send a message, or stop.';

    return handlerInput.responseBuilder
      .speak(speakOutput)
      .reprompt(reprompt)
      .withShouldEndSession(false)
      .getResponse();
  }
};

/**
 * Handle RepeatNotificationIntent: "Alexa, repeat that"
 */
const RepeatNotificationIntentHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === 'RepeatNotificationIntent';
  },
  async handle(handlerInput) {
    const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
    const lastSpoken = sessionAttributes.lastSpoken;

    if (!lastSpoken) {
      return handlerInput.responseBuilder
        .speak('There is nothing to repeat. You can ask me to read your notifications.')
        .reprompt('Say: read my notifications.')
        .withShouldEndSession(false)
        .getResponse();
    }

    const speakOutput = `Repeating: ${lastSpoken} Would you like to hear the next one?`;
    const reprompt = 'Say next to continue, or stop.';

    return handlerInput.responseBuilder
      .speak(speakOutput)
      .reprompt(reprompt)
      .withShouldEndSession(false)
      .getResponse();
  }
};

/**
 * Handle SummarizeNotificationsIntent: "Alexa, how many notifications do I have?"
 */
const SummarizeNotificationsIntentHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === 'SummarizeNotificationsIntent';
  },
  async handle(handlerInput) {
    try {
      const notifications = await notificationService.fetchActiveNotifications();
      const speakOutput = formatSummary(notifications);

      return handlerInput.responseBuilder
        .speak(speakOutput)
        .withShouldEndSession(true)
        .getResponse();
    } catch (err) {
      return handleServiceError(handlerInput, err);
    }
  }
};

/**
 * Handle ClearNotificationsIntent: "Alexa, ask Phone Reader to clear my notifications"
 */
const ClearNotificationsIntentHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === 'ClearNotificationsIntent';
  },
  async handle(handlerInput) {
    try {
      await notificationService.clearNotifications();
      return handlerInput.responseBuilder
        .speak('Your notifications have been cleared.')
        .withShouldEndSession(true)
        .getResponse();
    } catch (err) {
      return handleServiceError(handlerInput, err);
    }
  }
};

/**
 * Handle SetDndIntent: "Alexa, ask Phone Reader to enable Do Not Disturb"
 */
const SetDndIntentHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === 'SetDndIntent';
  },
  async handle(handlerInput) {
    const slot = Alexa.getSlot(handlerInput.requestEnvelope, 'status');
    const rawStatus = (slot && slot.value ? slot.value.toLowerCase().trim() : '') || 'on';
    const isEnable = rawStatus === 'on' || rawStatus === 'enable' || rawStatus === 'enabled' || rawStatus === 'true' || rawStatus === 'start' || rawStatus === 'turn on';

    try {
      const updated = await notificationService.updateSettings({ dndEnabled: isEnable });
      const priorityList = (updated.priorityApps || ['WhatsApp']).join(', ');

      const speakOutput = isEnable
        ? `Do Not Disturb is now turned on. I will only announce notifications from your priority apps: ${priorityList}.`
        : 'Do Not Disturb is now turned off. You will hear all notifications.';

      return handlerInput.responseBuilder
        .speak(speakOutput)
        .withShouldEndSession(true)
        .getResponse();
    } catch (err) {
      return handleServiceError(handlerInput, err);
    }
  }
};

/**
 * Handle GetDndStatusIntent: "Alexa, ask Phone Reader what is my DND status"
 */
const GetDndStatusIntentHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === 'GetDndStatusIntent';
  },
  async handle(handlerInput) {
    try {
      const settings = await notificationService.fetchSettings();
      const statusText = settings.dndEnabled ? 'enabled' : 'disabled';
      const priorityList = (settings.priorityApps || ['WhatsApp']).join(', ');

      const speakOutput = `Do Not Disturb is currently ${statusText}. Your priority apps are: ${priorityList}.`;

      return handlerInput.responseBuilder
        .speak(speakOutput)
        .withShouldEndSession(true)
        .getResponse();
    } catch (err) {
      return handleServiceError(handlerInput, err);
    }
  }
};

/**
 * Handle AddPriorityAppIntent: "Alexa, ask Phone Reader to add WhatsApp to priority"
 */
const AddPriorityAppIntentHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === 'AddPriorityAppIntent';
  },
  async handle(handlerInput) {
    const slot = Alexa.getSlot(handlerInput.requestEnvelope, 'appName');
    const appName = slot && slot.value ? slot.value.trim() : '';

    if (!appName) {
      return handlerInput.responseBuilder
        .speak('Which app would you like to add to your priority list? You can say WhatsApp or Instagram.')
        .reprompt('Which app would you like to add?')
        .withShouldEndSession(false)
        .getResponse();
    }

    try {
      const current = await notificationService.fetchSettings();
      const priorityApps = current.priorityApps || [];
      const exists = priorityApps.some(a => a.toLowerCase() === appName.toLowerCase());

      if (!exists) {
        priorityApps.push(appName);
        await notificationService.updateSettings({ priorityApps });
      }

      const speakOutput = `Added ${appName} to your priority apps list.`;
      return handlerInput.responseBuilder
        .speak(speakOutput)
        .withShouldEndSession(true)
        .getResponse();
    } catch (err) {
      return handleServiceError(handlerInput, err);
    }
  }
};

/**
 * Handle RemovePriorityAppIntent: "Alexa, ask Phone Reader to remove WhatsApp from priority"
 */
const RemovePriorityAppIntentHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === 'RemovePriorityAppIntent';
  },
  async handle(handlerInput) {
    const slot = Alexa.getSlot(handlerInput.requestEnvelope, 'appName');
    const appName = slot && slot.value ? slot.value.trim() : '';

    if (!appName) {
      return handlerInput.responseBuilder
        .speak('Which app would you like to remove from your priority list?')
        .reprompt('Which app would you like to remove?')
        .withShouldEndSession(false)
        .getResponse();
    }

    try {
      const current = await notificationService.fetchSettings();
      let priorityApps = current.priorityApps || [];
      priorityApps = priorityApps.filter(a => a.toLowerCase() !== appName.toLowerCase());
      await notificationService.updateSettings({ priorityApps });

      const speakOutput = `Removed ${appName} from your priority apps list.`;
      return handlerInput.responseBuilder
        .speak(speakOutput)
        .withShouldEndSession(true)
        .getResponse();
    } catch (err) {
      return handleServiceError(handlerInput, err);
    }
  }
};

/**
 * Handle AMAZON.NoIntent: "No"
 */
const NoIntentHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.NoIntent';
  },
  async handle(handlerInput) {
    const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
    if (sessionAttributes.awaitingClearConfirmation) {
      sessionAttributes.awaitingClearConfirmation = false;
      handlerInput.attributesManager.setSessionAttributes(sessionAttributes);
      return handlerInput.responseBuilder
        .speak("Okay, keeping your notifications saved.")
        .withShouldEndSession(true)
        .getResponse();
    }
    return handlerInput.responseBuilder
      .speak('Okay.')
      .withShouldEndSession(true)
      .getResponse();
  }
};

/**
 * Handle AMAZON.HelpIntent
 */
const HelpIntentHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.HelpIntent';
  },
  async handle(handlerInput) {
    const speakOutput = 'Mobile Reader lets you hear notifications from your Android phone. You can say: read my notifications, check messages from Mom, what is my OTP, how is my phone, or turn on do not disturb. What would you like to do?';
    return handlerInput.responseBuilder
      .speak(speakOutput)
      .reprompt('What would you like me to do?')
      .withShouldEndSession(false)
      .getResponse();
  }
};

/**
 * Handle AMAZON.CancelIntent & AMAZON.StopIntent
 */
const CancelAndStopIntentHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      (Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.CancelIntent' ||
       Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.StopIntent' ||
       Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.NavigateHomeIntent');
  },
  async handle(handlerInput) {
    return handlerInput.responseBuilder
      .speak('Goodbye.')
      .withShouldEndSession(true)
      .getResponse();
  }
};

/**
 * Handle AMAZON.FallbackIntent
 */
const FallbackIntentHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.FallbackIntent';
  },
  async handle(handlerInput) {
    const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();

    // 1. If awaiting secret PIN confirmation for reply, check if user spoke PIN in fallback
    if (sessionAttributes.awaitingSecretPinForReply) {
      const slots = (handlerInput.requestEnvelope.request.intent && handlerInput.requestEnvelope.request.intent.slots) || {};
      let rawText = '';
      for (const s of Object.values(slots)) {
        if (s && s.value) { rawText = s.value; break; }
      }
      const candidateKey = normalizeSpokenDigits(rawText);
      if (candidateKey && candidateKey.length >= 3) {
        return ConfirmSecretPinIntentHandler.handle(handlerInput);
      }
    }

    // 2. If awaiting reply recipient or reply message body
    if (sessionAttributes.awaitingReplyRecipient || sessionAttributes.awaitingReplyMessageBody) {
      const slots = (handlerInput.requestEnvelope.request.intent && handlerInput.requestEnvelope.request.intent.slots) || {};
      let spokenMessage = '';
      for (const s of Object.values(slots)) {
        if (s && s.value) { spokenMessage += ' ' + s.value; }
      }
      spokenMessage = spokenMessage.trim();

      // Check if user was clarifying or correcting the recipient (e.g. "to akhil jio", "to Mom", or if awaiting recipient: "akhil jio")
      const toRecipientMatch = spokenMessage.match(/^to\s+([a-zA-Z0-9_@]+(?:\s+[a-zA-Z0-9_@]+){0,2})$/i) ||
                               (sessionAttributes.awaitingReplyRecipient ? spokenMessage.match(/^([a-zA-Z0-9_@]+(?:\s+[a-zA-Z0-9_@]+){0,2})$/i) : null);
      if (toRecipientMatch) {
        const newRecipient = toRecipientMatch[1].trim();
        if (newRecipient && !/^(?:a\s+|the\s+)?(?:message|text|notification|someone|anyone)$/i.test(newRecipient)) {
          delete sessionAttributes.awaitingReplyRecipient;
          sessionAttributes.activeSenderContext = {
            senderName: newRecipient,
            appName: (sessionAttributes.activeSenderContext && sessionAttributes.activeSenderContext.appName) || 'WhatsApp'
          };
          sessionAttributes.awaitingReplyMessageBody = true;
          handlerInput.attributesManager.setSessionAttributes(sessionAttributes);
          return handlerInput.responseBuilder
            .speak(`What message would you like to send to ${newRecipient}?`)
            .reprompt(`What message would you like to send to ${newRecipient}?`)
            .withShouldEndSession(false)
            .getResponse();
        }
      }

      delete sessionAttributes.awaitingReplyRecipient;
      delete sessionAttributes.awaitingReplyMessageBody;
      spokenMessage = spokenMessage.replace(/^(?:reply\s+(?:with|saying|that)?|saying|that|with)\s*/i, '').trim();
      if (spokenMessage) {
        handlerInput.requestEnvelope.request.intent = {
          name: 'ReplyMessageIntent',
          slots: {
            replyMessage: { name: 'replyMessage', value: spokenMessage }
          }
        };
        return ReplyMessageIntentHandler.handle(handlerInput);
      }
    }

    // 3. If awaiting reply prompt ("Would you like to reply?"), check if affirmative
    if (sessionAttributes.awaitingReplyPrompt) {
      const slots = (handlerInput.requestEnvelope.request.intent && handlerInput.requestEnvelope.request.intent.slots) || {};
      let spoken = '';
      for (const s of Object.values(slots)) { if (s && s.value) spoken += ' ' + s.value; }
      spoken = spoken.toLowerCase().trim();
      if (/^(?:yes|yeah|sure|yep|haan|please|ok|okay|i\s+want\s+to\s+reply|reply)/i.test(spoken)) {
        return YesIntentHandler.handle(handlerInput);
      }
    }

    // 4. Build context for natural language understanding
    const activeCtx = sessionAttributes.activeSenderContext || {};
    const context = {
      activeSender: activeCtx.senderName || sessionAttributes.senderFilter || '',
      activeApp: activeCtx.appName || sessionAttributes.appFilter || 'WhatsApp',
      lastNotification: (sessionAttributes.notifications && sessionAttributes.currentIndex >= 0)
        ? sessionAttributes.notifications[sessionAttributes.currentIndex]
        : null
    };

    // Extract any spoken text from available slots
    const slots = (handlerInput.requestEnvelope.request.intent && handlerInput.requestEnvelope.request.intent.slots) || {};
    let openUtterance = '';
    for (const s of Object.values(slots)) {
      if (s && s.value) { openUtterance += ' ' + s.value; }
    }
    openUtterance = openUtterance.trim();

    if (openUtterance) {
      const classified = classifyOpenUtterance(openUtterance, context);
      if (classified.intent === 'ReplyMessageIntent') {
        if (classified.replyMessage) {
          sessionAttributes.awaitingSecretPinForReply = {
            senderName: classified.senderName || context.activeSender || 'your contact',
            appName: classified.appName || context.activeApp || 'WhatsApp',
            replyMessage: classified.replyMessage
          };
          handlerInput.attributesManager.setSessionAttributes(sessionAttributes);
          const recipient = sessionAttributes.awaitingSecretPinForReply.senderName;
          return handlerInput.responseBuilder
            .speak(`To confirm sending this message to ${recipient}: "${classified.replyMessage}". Please say your four digit secret key.`)
            .reprompt('Please say your four digit secret key to confirm sending this message.')
            .withShouldEndSession(false)
            .getResponse();
        } else {
          const recipient = classified.senderName || context.activeSender;
          const app = classified.appName || context.activeApp || 'WhatsApp';
          if (recipient) {
            sessionAttributes.activeSenderContext = { senderName: recipient, appName: app };
            sessionAttributes.awaitingReplyMessageBody = true;
            handlerInput.attributesManager.setSessionAttributes(sessionAttributes);
            return handlerInput.responseBuilder
              .speak(`What message would you like to send to ${recipient}?`)
              .reprompt(`What message would you like to send to ${recipient}?`)
              .withShouldEndSession(false)
              .getResponse();
          } else {
            sessionAttributes.awaitingReplyMessageBody = true;
            handlerInput.attributesManager.setSessionAttributes(sessionAttributes);
            return handlerInput.responseBuilder
              .speak('Who would you like to reply to, and what message should I send?')
              .reprompt('Who would you like to reply to?')
              .withShouldEndSession(false)
              .getResponse();
          }
        }
      }

      if (classified.intent === 'ReadNotificationsBySenderIntent') {
        handlerInput.requestEnvelope.request.intent = {
          name: 'ReadNotificationsBySenderIntent',
          slots: {
            senderName: { name: 'senderName', value: classified.senderName || '' },
            ...(classified.appName ? { appName: { name: 'appName', value: classified.appName } } : {})
          }
        };
        return ReadNotificationsBySenderIntentHandler.handle(handlerInput);
      }

      if (classified.intent === 'ReadNotificationsByAppIntent') {
        handlerInput.requestEnvelope.request.intent = {
          name: 'ReadNotificationsByAppIntent',
          slots: {
            appName: { name: 'appName', value: classified.appName || '' }
          }
        };
        return ReadNotificationsByAppIntentHandler.handle(handlerInput);
      }

      if (classified.intent === 'ReadNotificationsIntent') {
        return ReadNotificationsIntentHandler.handle(handlerInput);
      }

      if (classified.intent === 'ReadLatestNotificationIntent') {
        return ReadLatestNotificationIntentHandler.handle(handlerInput);
      }

      if (classified.intent === 'CheckBatteryIntent') {
        return CheckBatteryIntentHandler.handle(handlerInput);
      }
      if (classified.intent === 'CheckMissedCallsIntent') {
        return CheckMissedCallsIntentHandler.handle(handlerInput);
      }
      if (classified.intent === 'FindMyPhoneIntent') {
        return FindMyPhoneIntentHandler.handle(handlerInput);
      }
      if (classified.intent === 'DailyBriefingIntent') {
        return DailyBriefingIntentHandler.handle(handlerInput);
      }
      if (classified.intent === 'ReadOtpIntent') {
        return ReadOtpIntentHandler.handle(handlerInput);
      }
      if (classified.intent === 'WhoMessagedMeIntent') {
        return WhoMessagedMeIntentHandler.handle(handlerInput);
      }
    }

    const speakOutput = "Sorry, I didn't understand that request. You can say: read my notifications, check messages from Mom, reply, or turn on do not disturb.";
    return handlerInput.responseBuilder
      .speak(speakOutput)
      .reprompt('You can say: read my notifications, or reply to a message.')
      .withShouldEndSession(false)
      .getResponse();
  }
};

/**
 * Handle SessionEndedRequest
 */
const SessionEndedRequestHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'SessionEndedRequest';
  },
  async handle(handlerInput) {
    return handlerInput.responseBuilder.getResponse();
  }
};

/**
 * Global Error Handler - reports real error details for instant diagnostics
 */
const ErrorHandler = {
  canHandle() {
    return true;
  },
  async handle(handlerInput, error) {
    const rawError = error ? (error.message || error.stack || String(error)) : 'unknown error';
    console.error('Alexa ErrorHandler caught error:', rawError);
    const cleanError = rawError.replace(/[<>&]/g, ' ').slice(0, 200);
    const speakOutput = `Diagnostic error: ${cleanError}.`;
    return handlerInput.responseBuilder
      .speak(speakOutput)
      .withShouldEndSession(true)
      .getResponse();
  }
};

function handleServiceError(handlerInput, error) {
  const errMsg = error ? (error.message || String(error)) : 'unknown error';
  console.error('Notification service error:', errMsg);
  let speakOutput = `I couldn't retrieve your notifications right now. Reason: ${errMsg}.`;

  if (error && error.message === 'DEVICE_ID_NOT_CONFIGURED') {
    speakOutput = 'Your device ID is not configured in config.js. Please check your skill configuration.';
  } else if (error && error.message === 'BACKEND_NOT_CONFIGURED') {
    speakOutput = 'The backend service URL is not configured in config.js. Please check your skill settings.';
  } else if (error && (error.message === 'HTTP_401' || error.message === 'HTTP_403')) {
    speakOutput = 'Authentication failed with error 403. The API token in config.js does not match the token on your phone and Cloudflare.';
  } else if (error && error.message === 'HTTP_404') {
    speakOutput = 'Backend route was not found (404). Please verify your backend URL in config.js.';
  }

  return handlerInput.responseBuilder
    .speak(speakOutput)
    .withShouldEndSession(true)
    .getResponse();
}

/**
 * Lambda handler export
 */
const skillBuilder = Alexa.SkillBuilders.custom()
  .addRequestHandlers(
    LaunchRequestHandler,
    ReadNotificationsIntentHandler,
    ReadLatestNotificationIntentHandler,
    ReadNotificationsByAppIntentHandler,
    ReadNotificationsBySenderIntentHandler,
    WhoMessagedMeIntentHandler,
    ReadOtpIntentHandler,
    CheckPhoneStatusIntentHandler,
    ClearNotificationsByAppIntentHandler,
    ReplyMessageIntentHandler,
    ConfirmSecretPinIntentHandler,
    ChangeSecretKeyIntentHandler,
    CheckBatteryIntentHandler,
    FindMyPhoneIntentHandler,
    DismissFromPhoneIntentHandler,
    CheckMissedCallsIntentHandler,
    VipContactsIntentHandler,
    DailyBriefingIntentHandler,
    YesIntentHandler,
    ReadNextNotificationIntentHandler,
    RepeatNotificationIntentHandler,
    SummarizeNotificationsIntentHandler,
    ClearNotificationsIntentHandler,
    SetDndIntentHandler,
    GetDndStatusIntentHandler,
    AddPriorityAppIntentHandler,
    RemovePriorityAppIntentHandler,
    NoIntentHandler,
    HelpIntentHandler,
    CancelAndStopIntentHandler,
    FallbackIntentHandler,
    SessionEndedRequestHandler
  )
  .addErrorHandlers(ErrorHandler);

const skill = skillBuilder.create();
const baseHandler = skillBuilder.lambda();

/**
 * Top-level diagnostic wrapper:
 * Guarantees that even if an uncaught exception escapes the ASK SDK or occurs in the Lambda event cycle,
 * Alexa speaks the real error text aloud rather than "There was a problem with the requested skill's response".
 */
const handler = async function(event, context, callback) {
  try {
    return await new Promise((resolve, reject) => {
      baseHandler(event, context, (err, result) => {
        if (err) return reject(err);
        resolve(result);
      });
    });
  } catch (uncaughtErr) {
    console.error('CRITICAL TOP-LEVEL LAMBDA ERROR:', uncaughtErr);
    const rawMsg = (uncaughtErr && (uncaughtErr.message || uncaughtErr.stack || String(uncaughtErr))) || 'Unknown crash';
    const cleanMsg = rawMsg.replace(/[<>&]/g, ' ').slice(0, 200);
    return {
      version: '1.0',
      response: {
        outputSpeech: {
          type: 'PlainText',
          text: `Diagnostic error: ${cleanMsg}`
        },
        shouldEndSession: true
      }
    };
  }
};

exports.handler = handler;
exports.skill = skill;
