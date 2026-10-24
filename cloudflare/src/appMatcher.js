/**
 * Intelligent App Name Matcher with Normalization, Alias Expansion & Fuzzy Matching.
 * Handles Indian & Global app vernacular, misspellings, plurals, and carrier words.
 */

// Comprehensive App Aliases & Vernacular Dictionary
const APP_ALIASES = {
  whatsapp: ['whatsapp', 'com.whatsapp', 'whats app', 'what\'s app', 'watsapp', 'watsup', 'wa', 'whatapp', 'vatsapp'],
  instagram: ['instagram', 'com.instagram.android', 'insta', 'ig', 'instgram', 'threads', 'barcelona'],
  telegram: ['telegram', 'org.telegram.messenger', 'tg', 'tele', 'teligram'],
  messages: ['messages', 'message', 'sms', 'text', 'texts', 'messaging', 'com.google.android.apps.messaging', 'com.samsung.android.messaging'],
  gmail: ['gmail', 'mail', 'email', 'emails', 'g mail', 'google mail', 'com.google.android.gm'],
  phone: ['phone', 'call', 'calls', 'dialer', 'missed call', 'truecaller', 'com.google.android.dialer', 'com.truecaller', 'com.samsung.android.incallui'],
  swiggy: ['swiggy', 'in.swiggy.android', 'swigy', 'instamart', 'swiggy delivery'],
  zomato: ['zomato', 'com.application.zomato', 'zomto', 'zomatto', 'blinkit', 'com.grofers.customerapp'],
  zepto: ['zepto', 'com.zeptonow.android'],
  paytm: ['paytm', 'net.one97.paytm'],
  phonepe: ['phonepe', 'com.phonepe.app', 'phone pe'],
  gpay: ['gpay', 'google pay', 'g pay', 'com.google.android.apps.nbu.paisa.user'],
  slack: ['slack', 'com.Slack'],
  teams: ['teams', 'microsoft teams', 'com.microsoft.teams'],
  discord: ['discord', 'com.discord'],
  snapchat: ['snapchat', 'com.snapchat.android', 'snap', 'snaps'],
  youtube: ['youtube', 'com.google.android.youtube', 'yt', 'you tube'],
  spotify: ['spotify', 'com.spotify.music', 'spotfy'],
  linkedin: ['linkedin', 'com.linkedin.android', 'linked in', 'linkdin'],
  twitter: ['twitter', 'x', 'com.twitter.android', 'twt'],
  uber: ['uber', 'com.ubercab'],
  ola: ['ola', 'com.olacabs.customer'],
  kfc: ['kfc', 'kfc india', 'yum']
};

/**
 * Normalize an input string by lowercasing, removing non-alphanumeric chars,
 * and stripping filler words (e.g. "notification", "notifications", "message", "app").
 */
function normalizeAppName(input = '') {
  if (!input || typeof input !== 'string') return '';
  let str = input.toLowerCase().trim();

  // Strip common carrier suffixes and prefixes
  str = str.replace(/\b(notifications?|messages?|app|from|my|the|in|on)\b/gi, ' ');
  str = str.replace(/[^a-z0-9]/g, '');
  return str.trim();
}

/**
 * Standard Levenshtein distance calculation for spelling mistake tolerance.
 */
function levenshteinDistance(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const row = [];
  for (let i = 0; i <= b.length; i++) row[i] = i;

  for (let i = 1; i <= a.length; i++) {
    let prev = i;
    for (let j = 1; j <= b.length; j++) {
      let val;
      if (a[i - 1] === b[j - 1]) {
        val = row[j - 1];
      } else {
        val = Math.min(row[j - 1] + 1, prev + 1, row[j] + 1);
      }
      row[j - 1] = prev;
      prev = val;
    }
    row[b.length] = prev;
  }
  return row[b.length];
}

/**
 * Check if a candidate app matches a user query.
 *
 * @param {string} candidateName - App name or package name from DB (e.g. "WhatsApp", "com.whatsapp")
 * @param {string} userQuery - The app name spoken by the user (e.g. "whatsapp", "whats app", "insta")
 * @returns {boolean} True if matched
 */
function isAppMatch(candidateName = '', userQuery = '') {
  if (!candidateName || !userQuery) return false;

  const normCandidate = normalizeAppName(candidateName);
  const normQuery = normalizeAppName(userQuery);

  if (!normCandidate || !normQuery) return false;

  // 1. Direct exact or substring match
  if (normCandidate === normQuery || normCandidate.includes(normQuery) || normQuery.includes(normCandidate)) {
    return true;
  }

  // 2. Check alias dictionary
  for (const [canonical, aliases] of Object.entries(APP_ALIASES)) {
    const queryMatchesCanonical = (normQuery === canonical) || aliases.some(a => normalizeAppName(a) === normQuery);
    if (queryMatchesCanonical) {
      const candidateMatches = (normCandidate === canonical) || aliases.some(a => normCandidate.includes(normalizeAppName(a)));
      if (candidateMatches) return true;
    }
  }

  // 3. Fuzzy Levenshtein match (tolerance for spelling mistakes)
  const maxDistance = normQuery.length >= 6 ? 2 : (normQuery.length >= 4 ? 1 : 0);
  if (maxDistance > 0) {
    const dist = levenshteinDistance(normCandidate, normQuery);
    if (dist <= maxDistance) return true;
  }

  return false;
}

export {
  normalizeAppName,
  levenshteinDistance,
  isAppMatch,
  APP_ALIASES
};

export default {
  normalizeAppName,
  levenshteinDistance,
  isAppMatch,
  APP_ALIASES
};
