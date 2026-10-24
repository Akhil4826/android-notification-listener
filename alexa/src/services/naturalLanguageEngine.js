/**
 * Intelligent Natural Language Understanding & Reply Parsing Engine for Phone Reader.
 * 
 * Runs 100% locally in-process at ₹0.00 / $0.00 cost.
 * Provides:
 * - Dynamic Reply Parsing (understands "tell her...", "say...", "message Mom...", "reply that...", "yes, tell him...")
 * - Pronoun & Context Resolution ("her" / "him" / "them" -> resolves to current sender like Mom, Rahul, etc.)
 * - Conversational Prefix & Carrier Stripping
 * - Number & Word-to-Digit PIN normalization ("four eight two six" -> "4826")
 * - Smart Fallback Intent Router (understands unstructured utterances naturally)
 */

let nlp = null;
try {
  nlp = require('compromise');
  nlp.plugin({
    words: {
      mom: 'Person',
      dad: 'Person',
      mother: 'Person',
      father: 'Person',
      mummy: 'Person',
      papa: 'Person',
      bhai: 'Person',
      bro: 'Person',
      brother: 'Person',
      sister: 'Person',
      behen: 'Person',
      didi: 'Person',
      wife: 'Person',
      husband: 'Person',
      patni: 'Person',
      pati: 'Person',
      rahul: 'Person',
      priya: 'Person',
      amit: 'Person',
      pooja: 'Person',
      rohan: 'Person',
      sneha: 'Person',
      neha: 'Person',
      tanmay: 'Person',
      vikram: 'Person',
      ananya: 'Person',
      boss: 'Person',
      sir: 'Person',
      bhaiya: 'Person'
    }
  });
} catch (e) {
  // Compromise is optional; runs 100% standalone with built-in regex rules
  nlp = null;
}

const { isContactMatch } = require('./contactMatcher');

// Mapping word numbers to digits for phonetic/slang fallback
const WORD_TO_DIGIT = {
  zero: '0', oh: '0',
  one: '1',
  two: '2', to: '2', too: '2',
  three: '3',
  four: '4', for: '4', fore: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8', ate: '8',
  nine: '9'
};

/**
 * Convert spoken number words into digit string (e.g. "four eight two six", "forty eight twenty six" -> "4826").
 * Powered by compromise NLP library with regex/phonetic fallbacks.
 */
function normalizeSpokenDigits(input = '') {
  if (!input) return '';
  const text = input.toString().toLowerCase().trim();

  // 1. If already clean digits
  const directDigits = text.replace(/[\s-]/g, '');
  if (/^\d{3,8}$/.test(directDigits)) {
    return directDigits;
  }

  // 2. Try modern NLP (compromise) extraction for numbers (e.g. "forty eight twenty six", "four eight two six")
  if (nlp) {
    try {
      const doc = nlp(text);
      const parsedNumbers = doc.numbers().get();
      if (parsedNumbers && parsedNumbers.length > 0) {
        const combined = parsedNumbers.join('');
        if (/^\d{3,8}$/.test(combined)) {
          return combined;
        }
      }
    } catch (err) {
      // Ignore and proceed to fallback
    }
  }

  // 3. Fallback: Tokenize and map word numbers phonetically
  const tokens = text.split(/[\s,.-]+/);
  let result = '';
  for (const t of tokens) {
    if (/^\d+$/.test(t)) {
      result += t;
    } else if (WORD_TO_DIGIT[t] !== undefined) {
      result += WORD_TO_DIGIT[t];
    }
  }

  // If we found 3-8 digits, return them
  if (result.length >= 3 && result.length <= 8) {
    return result;
  }

  // 4. Match any continuous number sequence inside string
  const match = text.match(/\b\d{3,8}\b/);
  if (match) return match[0];

  return result;
}

/**
 * Cleans conversational affirmatives, greetings, and filler words from the start of an utterance.
 * E.g., "Yes, tell her I will be late" -> "tell her I will be late"
 * "haan tell her okay ji" -> "tell her okay ji"
 * "hey alexa ask phone reader to message Mom: I am here" -> "message Mom: I am here"
 */
function stripConversationalStarters(str = '') {
  if (!str || typeof str !== 'string') return '';
  let s = str.trim();

  // Strip leading slashes, backslashes, punctuation artifacts
  s = s.replace(/^[\\\/.,;:]+\s*/, '');

  // Strip leading invocation artifacts if passed in open text
  s = s.replace(/^(?:hey\s+)?alexa\s*[,.:;]?\s*/i, '');
  s = s.replace(/^(?:ask|open)\s+(?:phone\s+reader|mobile\s+reader|mobile|phone)\s*(?:to|and)?\s*/i, '');
  s = s.replace(/^[\\\/.,;:]+\s*/, '');
  s = s.replace(/^(?:backslash|forward\s*slash|slash)\s*/i, '');

  const starterRegex = /^(?:yes|yeah|yep|sure|haan|haa|ha|achha|ok|okay|please|alright|fine|definitely|just|backslash|slash)\b\s*[,.:;]?\s*/i;
  let prev = '';
  while (prev !== s && starterRegex.test(s)) {
    prev = s;
    s = s.replace(starterRegex, '').trim();
  }

  // Handle "i want to reply (to that message) (saying/with/that)"
  s = s.replace(/^(?:i\s+want\s+to\s+reply\s+(?:to\s+(?:that|this)\s+(?:message|notification)\s+)?(?:saying|that|with)?\s*)/i, 'reply ');
  s = s.replace(/^(?:i\s+would\s+like\s+to\s+reply\s+(?:to\s+(?:that|this)\s+(?:message|notification)\s+)?(?:saying|that|with)?\s*)/i, 'reply ');

  return s.trim();
}

/**
 * Dynamically parse a reply utterance without requiring exact hardcoded phrases.
 *
 * Handles inputs like:
 * - "message Mom: I will be there in 10 minutes."
 * - "Yes, tell her: see you tomorrow."
 * - "send a message to Mom saying see you tomorrow"
 * - "send Mom a message: I will be there in 10 minutes"
 * - "tell him I will be late by 15 mins"
 * - "text Rahul that let's meet at 5"
 * - "message Mom on WhatsApp saying see you tomorrow"
 * - "haan tell her okay ji"
 * - "drop Mom a text saying reached home safely"
 * - "reply that I am driving right now"
 * - "write back: thank you"
 * - "cutieepie that bye-bye on instagram"
 * - "send message to cutieepie that bye-bye on instagram"
 *
 * @param {string} utterance - Raw spoken text from slot or fallback
 * @param {Object} context - { activeSender, activeApp, lastNotification }
 * @returns {Object|null} - { isReply: boolean, recipient: string, app: string, message: string }
 */
function parseReplyUtterance(utterance = '', context = {}) {
  if (!utterance || typeof utterance !== 'string') return null;

  let text = stripConversationalStarters(utterance);
  if (!text) return null;

  // 1. Extract app name if explicitly specified in utterance (e.g. "on WhatsApp", "via Instagram")
  let targetApp = (context && (context.activeApp || (context.lastNotification && context.lastNotification.appName))) || 'WhatsApp';
  const appPattern = /\b(?:on|via|through|in)\s+(WhatsApp|Instagram|Insta|IG|Gmail|Messages|Telegram|Signal|SMS)\b/i;
  const appMatch = text.match(appPattern);
  if (appMatch) {
    const rawMatchedApp = appMatch[1].toLowerCase();
    if (/instagram|insta|ig/i.test(rawMatchedApp)) targetApp = 'Instagram';
    else if (/whatsapp/i.test(rawMatchedApp)) targetApp = 'WhatsApp';
    else if (/gmail/i.test(rawMatchedApp)) targetApp = 'Gmail';
    else if (/telegram/i.test(rawMatchedApp)) targetApp = 'Telegram';
    else if (/(?:messages|sms)/i.test(rawMatchedApp)) targetApp = 'Messages';
    else targetApp = appMatch[1];

    text = text.replace(appPattern, ' ').replace(/\s+/g, ' ').trim();
  }

  // 2. Identify and strip action phrases / verbs:
  let recipient = '';
  let remainder = '';

  // Pattern 1: Pronoun right after verb: "tell him/her/them [remainder]", "ask her [remainder]", "say to him [remainder]"
  const pronounPattern = /^(?:tell|message|text|inform|ping|say\s+to|reply\s+to|send\s+to)\s+(her|him|them|everyone|all)\b\s*[:：\-]?\s*(.*)$/i;
  const pronounMatch = text.match(pronounPattern);
  if (pronounMatch) {
    recipient = pronounMatch[1];
    remainder = pronounMatch[2].trim();
  }

  // Pattern 2: "send a (message|text|reply) to [recipient] saying/that/: [message]"
  if (!recipient) {
    const sendToConnPattern = /^(?:send|leave|drop)?\s*(?:a\s+)?(?:reply|message|text|note|voice\s+message)?\s*(?:to|for)\s+([a-zA-Z0-9_@]+(?:\s+[a-zA-Z0-9_@]+){0,2})\s+(?:that|saying|to\s+say|with|as\s+follows|[:：\-])\s*(.*)$/i;
    const connMatch = text.match(sendToConnPattern);
    if (connMatch && connMatch[1]) {
      recipient = connMatch[1].trim();
      remainder = connMatch[2].trim();
    }
  }

  // Pattern 3: "send [recipient] a (message|text|reply) [remainder]" or "drop [recipient] a (message|text) [remainder]"
  if (!recipient) {
    const sendObjPattern = /^(?:send|drop)\s+(.+?)\s+(?:a\s+)?(?:reply|message|text|note|voice\s+message|audio)\b\s*[:：\-]?\s*(.*)$/i;
    const sendObjMatch = text.match(sendObjPattern);
    if (sendObjMatch) {
      recipient = sendObjMatch[1].trim();
      remainder = sendObjMatch[2].trim();
    }
  }

  // Pattern 3B: "[verb] [recipient] saying/that/: [message]" (e.g. "text Rahul that let's meet at 5", "message Mom: hello")
  if (!recipient) {
    const verbRecipPattern = /^(?:tell|message|text|inform|ping|say\s+to|reply\s+to|send|drop)\s+([a-zA-Z0-9_@]+(?:\s+[a-zA-Z0-9_@]+){0,2})\s+(?:that|saying|to\s+say|with|as\s+follows|[:：\-])\s*(.*)$/i;
    const vMatch = text.match(verbRecipPattern);
    if (vMatch && vMatch[1]) {
      recipient = vMatch[1].trim();
      remainder = vMatch[2].trim();
    }
  }

  // Pattern 4: "let [recipient] know [remainder]"
  if (!recipient) {
    const letKnowPattern = /^let\s+([a-zA-Z0-9_@]+(?:\s+[a-zA-Z0-9_@]+){0,2})\s+know\b\s*[:：\-]?\s*(.*)$/i;
    const letKnowMatch = text.match(letKnowPattern);
    if (letKnowMatch) {
      recipient = letKnowMatch[1];
      remainder = letKnowMatch[2].trim();
    }
  }

  // Pattern 5: "send reply to [recipient]" or "reply to [recipient]" or "to [recipient]" (No message body)
  if (!recipient) {
    const toBarePattern = /^(?:send\s+)?(?:a\s+)?(?:reply|message|text)?\s*(?:to|for)\s+([a-zA-Z0-9_@]+(?:\s+[a-zA-Z0-9_@]+){0,2})$/i;
    const toBareMatch = text.match(toBarePattern);
    if (toBareMatch) {
      recipient = toBareMatch[1];
      remainder = '';
    }
  }

  // Pattern 6: Direct verb with colon: "message Mom: hello"
  if (!recipient) {
    const colonPattern = /^(?:tell|message|text|inform|ping|say|reply|write|send)\s+([a-zA-Z0-9_@]+(?:\s+[a-zA-Z0-9_@]+){0,2})\s*[:：\-]\s*(.*)$/i;
    const colonMatch = text.match(colonPattern);
    if (colonMatch) {
      recipient = colonMatch[1];
      remainder = colonMatch[2].trim();
    }
  }

  // Pattern 7: Bare verb without recipient: "reply that I am driving", "say hello", "reply saying I am here"
  if (!recipient) {
    const bareVerbPattern = /^(?:reply|write\s+back|say|respond|send|message|text)\s*(?:with|that|saying|to\s+say|[:：\-])?\s*(.*)$/i;
    const bareMatch = text.match(bareVerbPattern);
    if (bareMatch && bareMatch[1]) {
      recipient = '';
      remainder = bareMatch[1].trim();
    }
  }

  // Modern NLP Fallback powered by compromise:
  if (!remainder && !recipient && nlp) {
    try {
      const doc = nlp(text);
      if (doc.has('(say|tell|text|send|reply|write|message|inform|ping|ask|notify)')) {
        const foundPeople = doc.people().out('array');
        if (foundPeople && foundPeople.length > 0) {
          const person = foundPeople[0];
          const personIndex = text.toLowerCase().indexOf(person.toLowerCase());
          if (personIndex !== -1) {
            recipient = person;
            remainder = text.slice(personIndex + person.length).trim();
          }
        }
      }
    } catch (nlpErr) {
      // Fallback silently if NLP parsing throws
    }
  }

  // If no recognized reply structure was found, return null
  if (!remainder && !recipient) {
    return null;
  }

  // Discard generic placeholder nouns from recipient (e.g. "a message", "the message", "message", "a text", "someone")
  if (/^(?:a\s+|the\s+|this\s+|that\s+)?(?:message|text|notification|contact|chat|person|someone|anyone|something|voice\s*note)$/i.test(recipient)) {
    recipient = '';
  }

  // If recipient is "me", "us", or "alexa", it is an inquiry to the assistant, not a message to send
  if (/^(?:me|us|alexa)$/i.test(recipient)) {
    return null;
  }

  // 3. Resolve pronouns ("her", "him", "them", "everyone", "all")
  const isPronoun = /^(?:her|him|them|everyone|all)$/i.test(recipient);
  if (isPronoun || !recipient) {
    recipient = (context && (context.activeSender || (context.lastNotification && context.lastNotification.title))) || '';
  }

  // 4. Strip connectors from remainder:
  const connectorPattern = /^(?:[:\-]|that|saying|with|to\s+say|as\s+follows)\s*/i;
  while (connectorPattern.test(remainder)) {
    remainder = remainder.replace(connectorPattern, '').trim();
  }

  // Clean quotes from message
  const cleanMessage = remainder.replace(/^["']|["']$/g, '').trim();

  return {
    isReply: true,
    recipient: recipient || (context && context.activeSender) || 'your contact',
    app: targetApp,
    message: cleanMessage
  };
}

/**
 * Intelligent classifier for unhandled or open utterances (used in Fallback, Yes, or open slots).
 * Matches intents semantically based on keywords and patterns without strict phrasing.
 */
function classifyOpenUtterance(rawText = '', context = {}) {
  if (!rawText) return { intent: 'UNKNOWN' };
  const text = rawText.toLowerCase().trim();

  // 1. Check for secret PIN confirmation (e.g. "4826", "secret key is 4826", "four eight two six")
  const extractedPin = normalizeSpokenDigits(text);
  if (extractedPin && extractedPin.length >= 3 && extractedPin.length <= 8) {
    if (text.includes('pin') || text.includes('key') || text.includes('code') || /^\d+$/.test(extractedPin)) {
      return {
        intent: 'ConfirmSecretPinIntent',
        secretPin: extractedPin
      };
    }
  }

  // 2. Battery / charging query
  if (text.includes('battery') || (text.includes('charge') && !text.includes('discharge')) || text.includes('charging') || text.includes('power level')) {
    return { intent: 'CheckBatteryIntent' };
  }

  // 3. Missed calls query
  if ((text.includes('call') || text.includes('dialer') || text.includes('who called') || text.includes('rang')) &&
      (text.includes('miss') || text.includes('anyone') || text.includes('any') || text.includes('check') || text.includes('history'))) {
    return { intent: 'CheckMissedCallsIntent' };
  }

  // 4. Find my phone / ring ringer
  if ((text.includes('ring') || text.includes('find') || text.includes('locate') || text.includes('where is')) && text.includes('phone')) {
    if (text.includes('stop') || text.includes('silence') || text.includes('quiet') || text.includes('off')) {
      return { intent: 'FindMyPhoneIntent', stop: true };
    }
    return { intent: 'FindMyPhoneIntent', stop: false };
  }

  // 5. Dismiss notifications from physical phone
  if ((text.includes('dismiss') || text.includes('clear') || text.includes('clean') || text.includes('remove')) &&
      (text.includes('phone') || text.includes('screen') || text.includes('lock screen') || text.includes('drawer') || text.includes('bar'))) {
    return { intent: 'DismissFromPhoneIntent' };
  }

  // 6. Daily / Morning Briefing
  if (text.includes('briefing') || text.includes('daily summary') || text.includes('morning update') || text.includes('evening update')) {
    return { intent: 'DailyBriefingIntent' };
  }

  // 7. OTP / verification code
  if (text.includes('otp') || text.includes('verification code') || text.includes('security code') || (text.includes('code') && (text.includes('my') || text.includes('what')))) {
    return { intent: 'ReadOtpIntent' };
  }

  // 8. Who messaged me
  if (text.includes('who messaged') || text.includes('who texted') || text.includes('who sent') || text.includes('did anyone message')) {
    return { intent: 'WhoMessagedMeIntent' };
  }

  // 9. Check specific sender and/or app
  let extractedApp = '';
  const appMatch = text.match(/\b(whatsapp|wa|instagram|insta|ig|gmail|mail|telegram|messages|sms)\b/i);
  if (appMatch) {
    const rawA = appMatch[1].toLowerCase();
    if (/whatsapp|wa/i.test(rawA)) extractedApp = 'WhatsApp';
    else if (/instagram|insta|ig/i.test(rawA)) extractedApp = 'Instagram';
    else if (/gmail|mail/i.test(rawA)) extractedApp = 'Gmail';
    else if (/telegram/i.test(rawA)) extractedApp = 'Telegram';
    else if (/messages|sms/i.test(rawA)) extractedApp = 'Messages';
  }

  const senderQueryRegex = /(?:did|any\s+(?:message|messages|text|texts|notification|notifications)\s+from|check\s+(?:messages?|notifications?)\s+from|read\s+(?:my\s+)?(?:latest\s+)?(?:[a-z0-9]+\s+)?(?:notifications?|messages?|texts?)\s+from|i\s+want\s+(?:notifications?\s+)?from|from)\s+([a-zA-Z0-9_@]+(?:\s+[a-zA-Z0-9_@]+){0,3})(?:\s+(?:contact|notifications?|noptifications?|messages?|chats?))?/i;
  const senderMatch = text.match(senderQueryRegex);
  if (senderMatch) {
    let sName = senderMatch[1].trim();
    sName = sName.replace(/\b(?:from|contact|contacts|notifications?|noptifications?|messages?|chats?|dm|dms|latest)\b/gi, '').trim();
    if (sName && !/^(?:a\s+|the\s+)?(?:message|text|notification|someone|anyone)$/i.test(sName)) {
      return {
        intent: 'ReadNotificationsBySenderIntent',
        senderName: sName,
        appName: extractedApp
      };
    }
  }

  // Check if text is just "to [recipient]" when replying
  const toRecipientMatch = text.match(/^(?:to|for)\s+([a-zA-Z0-9_@]+(?:\s+[a-zA-Z0-9_@]+){0,3})(?:\s+(?:on|in|via)\s+([a-zA-Z0-9_@]+))?$/i);
  if (toRecipientMatch) {
    const rName = toRecipientMatch[1].trim();
    const appArg = toRecipientMatch[2] ? toRecipientMatch[2].trim() : (extractedApp || 'WhatsApp');
    if (!/^(?:a\s+|the\s+)?(?:message|text|notification|someone|anyone)$/i.test(rName)) {
      return {
        intent: 'ReplyMessageIntent',
        senderName: rName,
        appName: appArg,
        replyMessage: ''
      };
    }
  }

  // 10. Check for dynamic reply / message intent
  const replyParsed = parseReplyUtterance(rawText, context);
  if (replyParsed) {
    return {
      intent: 'ReplyMessageIntent',
      senderName: replyParsed.recipient,
      appName: replyParsed.app,
      replyMessage: replyParsed.message
    };
  }

  // 11. Check if user only asked for an app: e.g. "read whatsapp notifications"
  if (extractedApp && (text.includes('notification') || text.includes('message') || text.includes('read') || text.includes('check'))) {
    return {
      intent: 'ReadNotificationsByAppIntent',
      appName: extractedApp
    };
  }

  // 12. Check for general read notifications
  if (text.includes('read') && (text.includes('notification') || text.includes('message'))) {
    if (text.includes('latest') || text.includes('recent') || text.includes('newest') || text.includes('last')) {
      return { intent: 'ReadLatestNotificationIntent' };
    }
    return { intent: 'ReadNotificationsIntent' };
  }

  return { intent: 'UNKNOWN' };
}

module.exports = {
  normalizeSpokenDigits,
  stripConversationalStarters,
  parseReplyUtterance,
  classifyOpenUtterance,
  WORD_TO_DIGIT
};
