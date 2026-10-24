const { test, describe } = require('node:test');
const assert = require('node:assert');
const { parseReplyUtterance, normalizeSpokenDigits, classifyOpenUtterance } = require('../src/services/naturalLanguageEngine');

describe('Natural Language & Conversational Engine Suite', () => {

  const testCases = [
    {
      name: 'User Example 1: direct message with colon and minutes',
      input: "message Mom: I will be there in 10 minutes.",
      context: { activeSender: "Mom", activeApp: "WhatsApp" },
      expectedRecipient: "Mom",
      expectedMsg: "I will be there in 10 minutes."
    },
    {
      name: 'User Example 2: contextual reply with affirmative and pronoun',
      input: "Yes, tell her: see you tomorrow.",
      context: { activeSender: "Mom", activeApp: "WhatsApp" },
      expectedRecipient: "Mom",
      expectedMsg: "see you tomorrow."
    },
    {
      name: 'Pronoun without colon and with time duration',
      input: "tell him I will be late by 15 mins",
      context: { activeSender: "Rahul", activeApp: "WhatsApp" },
      expectedRecipient: "Rahul",
      expectedMsg: "I will be late by 15 mins"
    },
    {
      name: 'send a message to [recipient] saying [message]',
      input: "send a message to Mom saying see you tomorrow",
      context: { activeSender: "Mom", activeApp: "WhatsApp" },
      expectedRecipient: "Mom",
      expectedMsg: "see you tomorrow"
    },
    {
      name: 'send [recipient] a message: [message]',
      input: "send Mom a message: I will be there in 10 minutes",
      context: {},
      expectedRecipient: "Mom",
      expectedMsg: "I will be there in 10 minutes"
    },
    {
      name: 'text [recipient] that [message]',
      input: "text Rahul that let's meet at 5",
      context: {},
      expectedRecipient: "Rahul",
      expectedMsg: "let's meet at 5"
    },
    {
      name: 'App specified inside utterance: "on WhatsApp"',
      input: "message Mom on WhatsApp saying see you tomorrow",
      context: {},
      expectedRecipient: "Mom",
      expectedApp: "WhatsApp",
      expectedMsg: "see you tomorrow"
    },
    {
      name: 'Hinglish conversational affirmative: "haan tell her okay ji"',
      input: "haan tell her okay ji",
      context: { activeSender: "Didi", activeApp: "WhatsApp" },
      expectedRecipient: "Didi",
      expectedMsg: "okay ji"
    },
    {
      name: 'Informal verb phrase: "drop Mom a text saying reached home safely"',
      input: "drop Mom a text saying reached home safely",
      context: {},
      expectedRecipient: "Mom",
      expectedMsg: "reached home safely"
    },
    {
      name: 'Contextual notification reply: "reply that I am driving right now"',
      input: "reply that I am driving right now",
      context: { activeSender: "Priya", activeApp: "WhatsApp" },
      expectedRecipient: "Priya",
      expectedMsg: "I am driving right now"
    }
  ];

  for (const tc of testCases) {
    test(tc.name, () => {
      const parsed = parseReplyUtterance(tc.input, tc.context);
      assert.ok(parsed, `Failed to parse: "${tc.input}"`);
      if (tc.expectedRecipient) {
        assert.strictEqual(parsed.recipient.toLowerCase(), tc.expectedRecipient.toLowerCase());
      }
      if (tc.expectedMsg) {
        assert.strictEqual(parsed.message.toLowerCase(), tc.expectedMsg.toLowerCase());
      }
      if (tc.expectedApp) {
        assert.strictEqual(parsed.app.toLowerCase(), tc.expectedApp.toLowerCase());
      }
    });
  }

  test('normalizeSpokenDigits converts word numbers and mixed strings to clean digits', () => {
    assert.strictEqual(normalizeSpokenDigits('four eight two six'), '4826');
    assert.strictEqual(normalizeSpokenDigits('forty eight twenty six'), '4826');
    assert.strictEqual(normalizeSpokenDigits('four thousand eight hundred twenty six'), '4826');
    assert.strictEqual(normalizeSpokenDigits('secret key is four eight two six'), '4826');
    assert.strictEqual(normalizeSpokenDigits('my pin is 4826'), '4826');
    assert.strictEqual(normalizeSpokenDigits('four 8 two six'), '4826');
    assert.strictEqual(normalizeSpokenDigits('zero zero seven'), '007');
    assert.strictEqual(normalizeSpokenDigits('9 9 9 9'), '9999');
  });

  test('compromise NLP extracts person entities and informal communication verbs', () => {
    const parsed = parseReplyUtterance('ping Amit please bring the keys');
    assert.ok(parsed);
    assert.strictEqual(parsed.recipient.toLowerCase(), 'amit');
    assert.strictEqual(parsed.message, 'please bring the keys');
  });

  test('classifyOpenUtterance maps unstructured sentences to appropriate actions', () => {
    assert.strictEqual(classifyOpenUtterance('tell me my battery level').intent, 'CheckBatteryIntent');
    assert.strictEqual(classifyOpenUtterance('who called me or any missed calls').intent, 'CheckMissedCallsIntent');
    assert.strictEqual(classifyOpenUtterance('ring my phone please').intent, 'FindMyPhoneIntent');
    assert.strictEqual(classifyOpenUtterance('stop ringing my phone').stop, true);
    assert.strictEqual(classifyOpenUtterance('give me my morning briefing').intent, 'DailyBriefingIntent');
    assert.strictEqual(classifyOpenUtterance('what is my otp verification code').intent, 'ReadOtpIntent');
  });

});
