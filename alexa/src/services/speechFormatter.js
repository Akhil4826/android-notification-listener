/**
 * Formats natural speech for Alexa Echo devices based on captured Android notifications.
 * Handles single notification, empty results, pagination, content availability, privacy mode,
 * relative timestamps, and OTP extraction.
 */

// Comprehensive mapping of emojis to natural spoken words for Alexa TTS
const EMOJI_MAP = [
  // Hearts & love
  [/(?:\u{2764}\u{FE0F}?|[\u{1F496}\u{1F495}\u{1F497}\u{1F493}\u{1F49E}\u{1F49D}\u{1F90E}\u{1F90D}\u{1F9E1}\u{1F49B}\u{1F49A}\u{1F499}\u{1F49C}\u{1F5A4}\u{1F90F}])/gu, ' heart '],
  // Faces & reactions
  [/[\u{1F602}\u{1F923}]/gu, ' laughing emoji '],
  [/[\u{1F60D}\u{1F970}]/gu, ' heart eyes emoji '],
  [/[\u{1F618}\u{1F617}\u{1F619}\u{1F61A}]/gu, ' kiss emoji '],
  [/[\u{1F60A}\u{1F642}\u{1F600}\u{1F603}\u{1F604}\u{1F601}]/gu, ' smiling face '],
  [/[\u{1F609}]/gu, ' winking emoji '],
  [/[\u{1F60E}]/gu, ' cool emoji '],
  [/[\u{1F97A}]/gu, ' pleading face '],
  [/[\u{1F62D}\u{1F622}]/gu, ' crying emoji '],
  [/[\u{1F621}\u{1F92C}\u{1F620}]/gu, ' angry emoji '],
  [/[\u{1F914}]/gu, ' thinking emoji '],
  [/[\u{1F644}]/gu, ' eye roll '],
  [/[\u{1F634}]/gu, ' sleeping face '],
  // Hand gestures
  [/[\u{1F44D}]/gu, ' thumbs up '],
  [/[\u{1F44E}]/gu, ' thumbs down '],
  [/[\u{1F44B}]/gu, ' waving hand '],
  [/[\u{1F44F}]/gu, ' clapping hands '],
  [/[\u{1F64F}]/gu, ' folded hands '],
  [/[\u{1F64C}]/gu, ' raising hands '],
  [/[\u{1F44C}]/gu, ' okay sign '],
  [/[\u{1F91E}]/gu, ' fingers crossed '],
  // Emblems, party, fire
  [/[\u{1F525}]/gu, ' fire emoji '],
  [/[\u{1F4AF}]/gu, ' 100 percent '],
  [/[\u{2728}\u{1F31F}\u{2B50}]/gu, ' sparkles '],
  [/[\u{1F339}\u{1F490}\u{1F338}]/gu, ' rose '],
  [/[\u{1F382}]/gu, ' birthday cake '],
  [/[\u{1F440}]/gu, ' eyes emoji '],
  [/(?:\u{2705}|\u{2714}\u{FE0F}?)/gu, ' check mark '],
  [/[\u{274C}\u{274E}]/gu, ' cross mark ']
];

/**
 * Clean text for Alexa Speech Synthesis (SSML safety, emoji translation, URL handling)
 * Handles Hindi, Hinglish, English, numbers, and symbols smoothly.
 */
function cleanSpeechText(text = '') {
  if (!text || typeof text !== 'string') return '';

  let cleaned = text;

  // 1. Replace web links with simple "a link"
  cleaned = cleaned.replace(/https?:\/\/\S+/gi, 'a link');
  cleaned = cleaned.replace(/www\.\S+/gi, 'a link');

  // 1b. Translate media attachment tags and privacy placeholders for natural Alexa speech
  cleaned = cleaned.replace(/\[(?:Photo \/ Poster Attached|Photo Attached|Image Attached)\]/gi, 'sent a photo');
  cleaned = cleaned.replace(/\[Video Attached\]/gi, 'sent a video');
  cleaned = cleaned.replace(/\[(?:Voice Note \/ Audio Attached|Voice Note Attached|Audio Attached)\]/gi, 'sent a voice note');
  cleaned = cleaned.replace(/\[(?:PDF Document Attached|Document Attached|Document \/ File Attached)\]/gi, 'sent a document');
  cleaned = cleaned.replace(/\[Attachment(?::\s*[^\]]+)?\]/gi, 'sent an attachment');
  cleaned = cleaned.replace(/Sensitive notification content hidden/gi, 'a notification arrived while the device screen was locked');

  // 2. Translate popular expressive emojis to words so Alexa can speak them
  for (const [pattern, word] of EMOJI_MAP) {
    cleaned = cleaned.replace(pattern, word);
  }

  // 3. Strip any remaining rare Unicode emojis
  cleaned = cleaned.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{2300}-\u{23FF}]/gu, ' ');

  // 4. Escape SSML sensitive characters to prevent Alexa TTS errors
  cleaned = cleaned.replace(/&/g, ' and ');
  cleaned = cleaned.replace(/</g, ' less than ');
  cleaned = cleaned.replace(/>/g, ' greater than ');
  cleaned = cleaned.replace(/"/g, ' ');

  // 5. Clean up whitespace and newlines
  cleaned = cleaned.replace(/[\r\n\t]+/g, ' ');
  cleaned = cleaned.replace(/\s{2,}/g, ' ');

  return cleaned.trim();
}

/**
 * Convert an epoch timestamp into a natural spoken relative time.
 * E.g., "just now", "2 minutes ago", "1 hour ago", "yesterday", "3 days ago"
 *
 * @param {number|string} postedAt - Epoch timestamp in milliseconds
 * @param {number} now - Optional current timestamp for deterministic testing
 * @returns {string} Natural relative time phrase
 */
function getRelativeTimeString(postedAt, now = Date.now()) {
  if (!postedAt || isNaN(Number(postedAt))) return '';
  const ts = Number(postedAt);
  // If timestamp is before year 2020 (1577836800000 ms), treat as mock/invalid and omit relative time
  if (ts < 1577836800000) return '';

  const diffMs = Math.max(0, now - ts);
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHours = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSec < 60) {
    return 'just now';
  }
  if (diffMin < 60) {
    return diffMin === 1 ? '1 minute ago' : `${diffMin} minutes ago`;
  }
  if (diffHours < 24) {
    return diffHours === 1 ? '1 hour ago' : `${diffHours} hours ago`;
  }
  if (diffDays === 1) {
    return 'yesterday';
  }
  if (diffDays <= 30) {
    return `${diffDays} days ago`;
  }
  return '';
}

/**
 * Format speech for a single notification item.
 *
 * @param {Object} notif - Notification object
 * @param {Object} options - { isLatestOnly, privacyMode, prefixOrdinal, includeTimestamp }
 * @returns {string} Natural text for Alexa speech
 */
function formatSingleNotification(notif, { isLatestOnly = false, privacyMode = false, prefixOrdinal = '', includeTimestamp = true } = {}) {
  if (!notif) {
    return "You don't have any active notifications right now.";
  }

  const app = cleanSpeechText(notif.appName || 'your phone');
  const relTime = (includeTimestamp && notif.postedAt) ? getRelativeTimeString(notif.postedAt) : '';
  const timeClause = relTime ? `, ${relTime}` : '';

  // If user enabled privacy mode: announce app without reading sensitive contents
  if (privacyMode || process.env.PRIVACY_MODE === 'true') {
    if (isLatestOnly) {
      return `Your latest notification is from ${app}${timeClause}.`;
    }
    return `${prefixOrdinal ? `${prefixOrdinal}, ` : ''}You have a notification from ${app}${timeClause}.`;
  }

  // If content is not available or empty
  const hasNoContent = (notif.contentAvailable === false || notif.contentAvailable === 0) ||
                       (!notif.title && !notif.text && !notif.bigText);
  if (hasNoContent) {
    return `${prefixOrdinal ? `${prefixOrdinal}, ` : ''}You have a notification from ${app}${timeClause}, but its message content isn't available.`;
  }

/**
 * Summarize long notification text or multi-sender group chat into concise spoken sentence(s).
 */
function summarizeNotificationContent(bodyText, senderOrTitle, app) {
  if (!bodyText || typeof bodyText !== 'string') return '';
  const cleanBody = bodyText.replace(/[\u202F\u00A0]/g, ' ').trim();

  // 1. Group chat with multiple messages / multiple senders
  // e.g. "~ Sujith @ Group: ... ~ Prince ... Akhil Jio: so yep"
  const senderLineRegex = /(?:^|[\n\r~•\-]|\.\s+)\s*(?:~\s*)?([a-zA-Z0-9_@]+(?:\s+[a-zA-Z0-9_@]+){0,2})\s*(?:@\s*[^\n:]+?)?\s*[:：]\s*([^\n~•]+)/g;
  const foundMessages = [];
  let match;
  while ((match = senderLineRegex.exec(cleanBody)) !== null) {
    const sName = match[1].trim();
    const msg = match[2].trim();
    if (sName && msg && !/^(?:http|www|attachment|image|sticker|pinned)/i.test(sName)) {
      foundMessages.push({ sender: sName, message: msg });
    }
  }

  if (foundMessages.length >= 2 || (foundMessages.length >= 1 && cleanBody.length > 200)) {
    const distinctSenders = Array.from(new Set(foundMessages.map(m => m.sender)));
    const totalCount = foundMessages.length;
    const latestMsg = foundMessages[foundMessages.length - 1];

    let sendersSummary = '';
    if (distinctSenders.length === 1) {
      sendersSummary = distinctSenders[0];
      return `${sendersSummary} sent ${totalCount} messages. The latest message says: ${cleanSpeechText(latestMsg.message)}`;
    } else if (distinctSenders.length <= 3) {
      sendersSummary = distinctSenders.slice(0, 2).join(' and ');
      if (distinctSenders.length === 3) {
        sendersSummary = `${distinctSenders[0]}, ${distinctSenders[1]}, and ${distinctSenders[2]}`;
      }
    } else {
      sendersSummary = `${distinctSenders[0]}, ${distinctSenders[1]}, and others`;
    }

    const cleanGroupTitle = senderOrTitle ? cleanSpeechText(senderOrTitle) : 'the group';
    return `In ${cleanGroupTitle}, there are ${totalCount} messages from ${sendersSummary}. The latest message from ${latestMsg.sender} says: ${cleanSpeechText(latestMsg.message)}`;
  }

  // 2. Single sender with multiple chats / lines (e.g. "hey \n are you free \n check this")
  const lines = cleanBody.split(/[\n\r]+/).map(l => l.trim()).filter(Boolean);
  if (lines.length >= 3) {
    const latestLine = cleanSpeechText(lines[lines.length - 1]);
    const sender = senderOrTitle || 'your contact';
    return `${sender} sent ${lines.length} messages. The latest message says: ${latestLine}`;
  }

  // 3. Single message that is very long (> 220 chars)
  if (cleanBody.length > 220) {
    const firstPeriod = cleanBody.indexOf('.', 60);
    if (firstPeriod !== -1 && firstPeriod <= 170) {
      const summarySnippet = cleanSpeechText(cleanBody.slice(0, firstPeriod).trim());
      return `${summarySnippet}, and more`;
    }
    const cut = cleanBody.slice(0, 140).replace(/\s+\S*$/, '');
    return `${cleanSpeechText(cut)}, and more`;
  }

  return cleanBody;
}

  let bodyText = cleanSpeechText(notif.bigText || notif.text || '');
  let senderOrTitle = cleanSpeechText(notif.title || '');

  // Instagram / messaging clean: if title is "username: Contact Name", extract actual contact name
  if (/[:：]\s*/.test(senderOrTitle)) {
    const parts = senderOrTitle.split(/[:：]\s*/);
    if (parts.length > 1 && parts[parts.length - 1].trim()) {
      senderOrTitle = parts[parts.length - 1].trim();
    }
  }

  // If bodyText starts with senderOrTitle + colon, strip the duplicate
  if (senderOrTitle && bodyText) {
    const escSender = senderOrTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    bodyText = bodyText.replace(new RegExp(`^${escSender}\\s*[:：\\-]\\s*`, 'i'), '').trim();
  }

  // If bodyText was just an emoji and ended up empty or just punctuation
  if (!bodyText || /^[:：\-\s.,!]+$/.test(bodyText)) {
    const rawContent = (notif.text || '') + (notif.bigText || '');
    for (const [pattern, word] of EMOJI_MAP) {
      if (pattern.test(rawContent)) {
        bodyText = word.trim();
        break;
      }
    }
    if (!bodyText || /^[:：\-\s.,!]+$/.test(bodyText)) {
      if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(rawContent)) {
        bodyText = 'an emoji reaction';
      } else {
        bodyText = '';
      }
    }
  }

  // Intelligent summarization for groups with many messages or very long chats
  const summarized = summarizeNotificationContent(bodyText, senderOrTitle, app);
  if (summarized && summarized !== bodyText) {
    if (/^In\s+/i.test(summarized) || /\bmessages?\s+from\b/i.test(summarized) || /\bsent\s+\d+\s+messages\b/i.test(summarized)) {
      if (isLatestOnly) {
        return `Your latest notification is from ${app}${timeClause}. ${summarized}.`;
      }
      return `${prefixOrdinal ? `${prefixOrdinal}, ` : ''}from ${app}${timeClause}: ${summarized}.`;
    }
    bodyText = summarized;
  }

  const isTitleApp = senderOrTitle.toLowerCase() === app.toLowerCase() ||
                     app.toLowerCase().includes(senderOrTitle.toLowerCase());
  const formattedBody = bodyText ? (/[.?!]$/.test(bodyText) ? bodyText : `${bodyText}.`) : '';
  const formattedTitle = senderOrTitle ? (/[.?!]$/.test(senderOrTitle) ? senderOrTitle : `${senderOrTitle}.`) : '';

  if (isLatestOnly) {
    if (senderOrTitle && !isTitleApp && bodyText && senderOrTitle !== bodyText) {
      return `Your latest notification is from ${app}${timeClause}. ${senderOrTitle} says: ${formattedBody}`;
    } else if (bodyText) {
      return `Your latest ${app} notification${timeClause} says: ${formattedBody}`;
    } else {
      return `Your latest notification is from ${app}${timeClause}: ${senderOrTitle}.`;
    }
  }

  const prefix = prefixOrdinal ? `${prefixOrdinal}, ` : '';

  if (senderOrTitle && !isTitleApp && bodyText && senderOrTitle !== bodyText) {
    return `${prefix}from ${app}${timeClause}, ${senderOrTitle} says: ${formattedBody}`;
  } else if (bodyText) {
    return `${prefix}from ${app}${timeClause}: ${formattedBody}`;
  } else {
    return `${prefix}from ${app}${timeClause}: ${formattedTitle}`;
  }
}

/**
 * Extract OTP or verification code from a list of notifications.
 *
 * @param {Array<Object>} notifications - Active notification list
 * @returns {Object|null} { code, spacedDigits, sender, appName, relativeTime, rawBody }
 */
function extractOtp(notifications = []) {
  if (!Array.isArray(notifications) || notifications.length === 0) {
    return null;
  }

  // Regex to detect OTP keyword presence
  const otpKeywordRegex = /\b(otp|code|verification code|one time password|passcode|pin|security code|login code)\b/i;

  // Regex to extract 4 to 8 digit numbers, allowing spaced or hyphenated (e.g., 492 018 or 492-018)
  const codeRegex = /\b\d{4,8}\b|\b\d{3}[-\s]\d{3}\b/g;

  for (const notif of notifications) {
    const rawTitle = notif.title || '';
    const rawText = notif.text || '';
    const rawBigText = notif.bigText || '';
    const fullText = `${rawTitle} ${rawText} ${rawBigText}`.trim();

    if (!otpKeywordRegex.test(fullText)) {
      continue;
    }

    const matches = fullText.match(codeRegex);
    if (!matches || matches.length === 0) continue;

    const candidates = matches
      .map(m => m.replace(/[-\s]/g, ''))
      .filter(m => m.length >= 4 && m.length <= 8);

    if (candidates.length === 0) continue;

    let bestCode = null;
    for (const cand of candidates) {
      const isYear = /^202[0-9]$/.test(cand);
      const contextualRegex = new RegExp(`(?:otp|code|is|pin|verification)\\s*[:\\-]?\\s*${cand}|${cand}\\s*(?:is your|is the)`, 'i');
      if (contextualRegex.test(fullText)) {
        bestCode = cand;
        break;
      }
      if (!bestCode && !isYear) {
        bestCode = cand;
      }
    }

    if (!bestCode) {
      bestCode = candidates[0];
    }

    const sender = notif.title || notif.appName || 'your phone';
    const relTime = notif.postedAt ? getRelativeTimeString(notif.postedAt) : '';
    const bodySnippet = cleanSpeechText(rawText || rawBigText || rawTitle);
    const spacedDigits = bestCode.split('').join(' ');

    return {
      code: bestCode,
      spacedDigits,
      sender: cleanSpeechText(sender),
      appName: cleanSpeechText(notif.appName || 'Messages'),
      relativeTime: relTime,
      rawBody: bodySnippet
    };
  }

  return null;
}

/**
 * Convert numeric 0-indexed position to spoken ordinal string ("First", "Second", etc.).
 */
function getOrdinal(index) {
  const ordinals = [
    'First', 'Second', 'Third', 'Fourth', 'Fifth',
    'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth'
  ];
  return ordinals[index] || `Notification ${index + 1}`;
}

/**
 * Summarize a list of notifications by app count.
 * E.g., "You have 3 active notifications: 2 from WhatsApp and 1 from Instagram."
 */
function formatSummary(notifications = [], appFilter = '') {
  const total = notifications.length;
  if (total === 0) {
    if (appFilter) {
      return `You don't have any active notifications from ${appFilter} right now.`;
    }
    return "You don't have any active notifications right now.";
  }

  if (appFilter) {
    return `You have ${total} active notification${total > 1 ? 's' : ''} from ${appFilter}.`;
  }

  // Group counts by app
  const appCounts = {};
  for (const n of notifications) {
    const app = n.appName || 'Other';
    appCounts[app] = (appCounts[app] || 0) + 1;
  }

  const appPhrases = Object.entries(appCounts).map(
    ([app, count]) => `${count} from ${app}`
  );

  let breakdown = '';
  if (appPhrases.length === 1) {
    breakdown = appPhrases[0];
  } else if (appPhrases.length === 2) {
    breakdown = `${appPhrases[0]} and ${appPhrases[1]}`;
  } else {
    const last = appPhrases.pop();
    breakdown = `${appPhrases.join(', ')}, and ${last}`;
  }

  return `You have ${total} active notification${total > 1 ? 's' : ''}: ${breakdown}.`;
}

/**
 * Format speech response for sender-specific queries with natural assistant persona.
 * E.g. "Yes! Rahul sent you a message on WhatsApp, 2 minutes ago. Rahul says: Are you coming today?"
 * Or "No, you don't have any messages from Rahul. Your phone is up to date."
 */
function formatSenderResponse({ notifications = [], senderName = '', otherActive = [] } = {}) {
  const cleanSender = cleanSpeechText(senderName);
  if (!notifications || notifications.length === 0) {
    if (otherActive && otherActive.length > 0) {
      const distinctApps = Array.from(new Set(otherActive.map(n => cleanSpeechText(n.appName || 'Unknown')))).slice(0, 3);
      const otherAppsText = distinctApps.join(' and ');
      return {
        speech: `No, you don't have any messages from ${cleanSender} right now. But you have notifications from ${otherAppsText}. Would you like me to read them?`,
        hasResults: false,
        hasOther: true
      };
    }
    return {
      speech: `No, you don't have any new messages from ${cleanSender}. Your phone is all caught up.`,
      hasResults: false,
      hasOther: false
    };
  }

  const total = notifications.length;
  const first = notifications[0];
  const app = cleanSpeechText(first.appName || 'your phone');
  const actualName = cleanSpeechText(first.title || cleanSender);
  const relTime = first.postedAt ? getRelativeTimeString(first.postedAt) : '';
  const timeClause = relTime ? `, ${relTime}` : '';
  const rawContent = (first.bigText || first.text || '');
  const body = cleanSpeechText(rawContent);

  // Check if senderName was inside a group chat / multi-message notification
  const { extractSenderMessageFromGroup, isContactMatch } = require('./contactMatcher');
  const groupMsg = extractSenderMessageFromGroup(rawContent, cleanSender);

  if (groupMsg && !isContactMatch(first.title || '', '', '', cleanSender)) {
    const cleanGroupTitle = cleanSpeechText(first.title || 'the group');
    const cleanGroupMsg = cleanSpeechText(groupMsg.message);
    const speech = `Yes! In ${cleanGroupTitle} on ${app}${timeClause}, ${groupMsg.sender} says: ${cleanGroupMsg}.`;
    return {
      speech,
      hasResults: true,
      total: 1,
      sender: groupMsg.sender,
      appName: app
    };
  }

  if (total === 1) {
    const messagePart = body && body !== actualName ? ` ${actualName} says: ${body}.` : '';
    return {
      speech: `Yes! You have a message from ${actualName} on ${app}${timeClause}.${messagePart}`,
      hasResults: true,
      total: 1
    };
  }

  const messagePart = body && body !== actualName ? ` The latest one says: ${body}.` : '';
  return {
    speech: `Yes! You have ${total} messages from ${actualName} on ${app}.${messagePart} Would you like to hear the next message?`,
    hasResults: true,
    total
  };
}

/**
 * Format summary of who contacted the user across all apps.
 * E.g. "You have messages from Mom on WhatsApp, and Rahul on Instagram."
 */
function formatWhoMessagedSummary(notifications = []) {
  if (!notifications || notifications.length === 0) {
    return "You don't have any active messages or notifications right now.";
  }

  const sendersByApp = {};
  for (const n of notifications) {
    const app = cleanSpeechText(n.appName || 'Other');
    const sender = cleanSpeechText(n.title || '');
    if (!sendersByApp[app]) {
      sendersByApp[app] = [];
    }
    if (sender && !sendersByApp[app].includes(sender) && sender.toLowerCase() !== app.toLowerCase()) {
      sendersByApp[app].push(sender);
    }
  }

  const parts = [];
  for (const [app, senders] of Object.entries(sendersByApp)) {
    if (senders.length > 0) {
      const sendersList = senders.length <= 2 ? senders.join(' and ') : `${senders.slice(0, 2).join(', ')} and others`;
      parts.push(`${sendersList} on ${app}`);
    } else {
      parts.push(`${app}`);
    }
  }

  if (parts.length === 0) {
    return `You have ${notifications.length} active notification${notifications.length > 1 ? 's' : ''}. Would you like me to read them?`;
  }

  const summary = parts.length === 1 ? parts[0] : parts.slice(0, -1).join(', ') + ' and ' + parts.slice(-1);
  return `You have notifications from ${summary}. Would you like me to read them?`;
}

/**
 * Format conversational battery status response.
 */
function formatBatteryResponse(status = {}) {
  const level = typeof status.batteryLevel === 'number' ? status.batteryLevel : 100;
  const isCharging = Boolean(status.isCharging);
  const chargingType = status.chargingType || 'NONE';

  if (isCharging) {
    const powerSource = chargingType === 'AC' ? 'A.C. fast charger' : (chargingType === 'WIRELESS' ? 'wireless charger' : 'charger');
    return `Your phone is at ${level}% battery, and is currently plugged into a ${powerSource}.`;
  }

  if (level <= 15) {
    return `Caution: your phone battery is critically low at ${level}%. Please plug your phone into a charger now.`;
  }

  if (level <= 30) {
    return `Your phone is at ${level}% battery and is discharging. You might want to plug it in soon.`;
  }

  return `Your phone is in good shape at ${level}% battery.`;
}

/**
 * Format conversational missed calls response.
 */
function formatMissedCallsResponse(calls = []) {
  if (!calls || calls.length === 0) {
    return "You don't have any missed calls right now. Your phone is all clear.";
  }

  const total = calls.length;
  if (total === 1) {
    const call = calls[0];
    const caller = cleanSpeechText(call.title || 'Unknown Caller');
    const app = cleanSpeechText(call.appName || 'Phone');
    const relTime = call.postedAt ? `, ${getRelativeTimeString(call.postedAt)}` : '';
    return `You have 1 missed call from ${caller} on ${app}${relTime}.`;
  }

  const callerList = calls.slice(0, 3).map(c => {
    const name = cleanSpeechText(c.title || 'Unknown');
    const rel = c.postedAt ? ` (${getRelativeTimeString(c.postedAt)})` : '';
    return `${name}${rel}`;
  }).join(', and ');

  const overflow = total > 3 ? ` and ${total - 3} other call${total - 3 > 1 ? 's' : ''}` : '';
  return `You have ${total} missed calls: ${callerList}${overflow}.`;
}

/**
 * Format daily briefing audio report.
 */
function formatDailyBriefing(briefing = {}) {
  const battery = briefing.batteryLevel ?? 100;
  const total = briefing.totalActiveNotifications ?? 0;
  const missedCalls = briefing.missedCallsCount ?? 0;
  const vipCount = briefing.vipMessagesCount ?? 0;
  const emergencyCount = briefing.emergencyCount ?? 0;

  const parts = [];
  parts.push(`Your phone is at ${battery}% battery.`);

  if (missedCalls > 0) {
    parts.push(`You have ${missedCalls} missed call${missedCalls > 1 ? 's' : ''}.`);
  }

  if (emergencyCount > 0) {
    parts.push(`Alert: you have ${emergencyCount} urgent or emergency message${emergencyCount > 1 ? 's' : ''}.`);
  }

  if (vipCount > 0) {
    const vipNames = briefing.vipMessages.map(m => cleanSpeechText(m.title || 'VIP')).slice(0, 2).join(' and ');
    parts.push(`You have messages from ${vipNames}.`);
  }

  if (total === 0) {
    parts.push("You have no other active notifications. Your phone is all caught up.");
  } else {
    parts.push(`You have a total of ${total} active notification${total > 1 ? 's' : ''}.`);
  }

  return `Here is your phone briefing: ${parts.join(' ')} Would you like me to read your notifications?`;
}

module.exports = {
  formatSingleNotification,
  getOrdinal,
  formatSummary,
  cleanSpeechText,
  getRelativeTimeString,
  extractOtp,
  formatSenderResponse,
  formatWhoMessagedSummary,
  formatBatteryResponse,
  formatMissedCallsResponse,
  formatDailyBriefing
};

