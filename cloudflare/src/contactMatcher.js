/**
 * Intelligent Contact & Sender Matching Engine for Phone Reader.
 * Supports:
 * - Real-time arbitrary contacts, names, and Instagram/social usernames
 * - Relationship alias mapping (Mom/Mummy/Mother/Maa, Dad/Papa/Father, etc.)
 * - Token-based matching (e.g. "Rahul" matches "Rahul Sharma", "Rahul (Work)")
 * - Social handles (e.g. "@tanmay_bhat" matches "tanmay")
 * - Levenshtein distance for typos and phonetic variations
 */

const RELATIONSHIP_ALIASES = {
  mom: ['mom', 'mummy', 'mother', 'maa', 'ammi', 'aai', 'mommy', 'mama'],
  dad: ['dad', 'daddy', 'papa', 'father', 'pops', 'appa', 'bapuji', 'abba'],
  brother: ['brother', 'bro', 'bhai', 'bhaiya', 'veere'],
  sister: ['sister', 'sis', 'behen', 'didi'],
  wife: ['wife', 'patni', 'biwi'],
  husband: ['husband', 'pati']
};

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(a, b) {
  if (!a || !b) return (a || b).length;
  const matrix = [];

  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Normalize contact or search string
 */
function normalizeContactString(str = '') {
  if (!str || typeof str !== 'string') return '';
  return str
    .replace(/[\u202F\u00A0]/g, ' ')
    .toLowerCase()
    .replace(/[@#\-_.]/g, ' ')
    .replace(/[()[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Check if relationship alias matches (e.g., user asks for "Mom", contact is "Mummy")
 */
function matchesRelationshipAlias(title, search) {
  const cleanSearch = search.toLowerCase().trim();
  const cleanTitle = title.toLowerCase().trim();

  for (const [key, aliases] of Object.entries(RELATIONSHIP_ALIASES)) {
    const searchMatches = aliases.includes(cleanSearch) || cleanSearch === key;
    if (searchMatches) {
      // Check if title contains any alias from the family
      const titleTokens = cleanTitle.split(/\s+/);
      const hasAliasMatch = aliases.some(alias => 
        cleanTitle === alias || 
        titleTokens.includes(alias) || 
        cleanTitle.startsWith(alias)
      );
      if (hasAliasMatch) return true;
    }
  }

  return false;
}

/**
 * Check if candidate title / subtext / text matches the searched sender.
 *
 * @param {string} candidateTitle - Notification title (typically contact name or username)
 * @param {string} candidateSubText - Notification subText (optional group or sender context)
 * @param {string} candidateText - Notification text body
 * @param {string} searchTerm - Spoken search term from user (e.g., "Rahul", "Mom", "alex99", "akhil jio contact")
 * @returns {boolean}
 */
function isContactMatch(candidateTitle = '', candidateSubText = '', candidateText = '', searchTerm = '') {
  if (!searchTerm || typeof searchTerm !== 'string') return false;

  // Strip noise suffixes/prefixes from spoken query
  const cleanSearchTerm = searchTerm
    .replace(/\b(?:from|contact|contacts|notifications?|noptifications?|messages?|chats?|dm|dms|latest)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const search = normalizeContactString(cleanSearchTerm || searchTerm);
  if (!search) return false;

  const title = normalizeContactString(candidateTitle);
  const subText = normalizeContactString(candidateSubText);
  const text = normalizeContactString(candidateText);

  // 1. Exact match on title or subText
  if (title === search || subText === search) {
    return true;
  }

  // 2. Relationship alias matching (e.g. Mom <-> Mummy <-> Mother <-> Maa)
  if (matchesRelationshipAlias(candidateTitle, search) || matchesRelationshipAlias(candidateSubText, search)) {
    return true;
  }

  // 3. Substring match
  if (title.length > 0 && (title.includes(search) || search.includes(title))) {
    return true;
  }

  // 4. Token-level matching (e.g., search "Rahul" matches "Rahul Sharma" or "Dr Rahul")
  const titleTokens = title.split(' ').filter(Boolean);
  const searchTokens = search.split(' ').filter(Boolean);

  for (const sToken of searchTokens) {
    if (sToken.length < 2) continue;

    // Check exact token match
    if (titleTokens.includes(sToken)) {
      return true;
    }

    // Check token prefix match (e.g. "alex" matches "alexander")
    if (titleTokens.some(t => t.startsWith(sToken) || sToken.startsWith(t))) {
      return true;
    }

    // Check fuzzy match on tokens (e.g. "Rohan" vs "Rohann", "Priya" vs "Preeya")
    for (const tToken of titleTokens) {
      if (tToken.length >= 4 && sToken.length >= 4) {
        const dist = levenshteinDistance(sToken, tToken);
        if (dist <= 1) return true;
        if (sToken.length >= 6 && dist <= 2) return true;
      }
    }
  }

  // 5. Match sender names inside group chats, thread summaries, or multi-line notifications
  // e.g. "~ Sujith @ Group: ...", "~ Akhil Jio: so yep", "Akhil Jio: hello", "tanmay_bhat: reel"
  if (candidateText && candidateText.length > 0) {
    const cleanText = candidateText.replace(/[\u202F\u00A0]/g, ' ');
    const senderLineRegex = /(?:^|[\n\r~•\-]|\.\s+)\s*(?:~\s*)?([a-zA-Z0-9_@]+(?:\s+[a-zA-Z0-9_@]+){0,3})\s*(?:@\s*[^\n:]+?)?\s*[:：]\s*/g;
    let match;
    while ((match = senderLineRegex.exec(cleanText)) !== null) {
      const embeddedSender = normalizeContactString(match[1]);
      if (embeddedSender) {
        if (embeddedSender === search || embeddedSender.includes(search) || search.includes(embeddedSender)) {
          return true;
        }
        if (matchesRelationshipAlias(embeddedSender, search)) {
          return true;
        }
        const embeddedTokens = embeddedSender.split(' ').filter(Boolean);
        for (const sToken of searchTokens) {
          if (sToken.length >= 2 && embeddedTokens.includes(sToken)) {
            return true;
          }
        }
      }
    }

    if (text.includes(`${search}:`) || text.includes(`${search} :`) || text.includes(`~ ${search}`) || text.includes(`~${search}`)) {
      return true;
    }
  }

  return false;
}

/**
 * Extracts a specific sender's message from a group notification or multi-message notification.
 * E.g., for WhatsApp group where Akhil Jio says: "so yep", returns { sender: "Akhil Jio", message: "so yep" }
 */
function extractSenderMessageFromGroup(rawText = '', searchTerm = '') {
  if (!rawText || !searchTerm) return null;
  const cleanText = rawText.replace(/[\u202F\u00A0]/g, ' ').trim();
  const search = normalizeContactString(searchTerm.replace(/\b(?:from|contact|contacts|notifications?|noptifications?|messages?|chats?|dm|dms|latest)\b/gi, ''));
  if (!search) return null;

  // 1. Direct targeted match for search term (e.g. "Akhil Jio: so yep", "~ Akhil Jio @ Group: so yep")
  const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  const directRegex = new RegExp(`(?:^|[\\s~•\\-])(~?\\s*)(${escapedSearch}[a-zA-Z0-9_@\\s]{0,10})\\s*(?:@\\s*[^:：\\n]+?)?\\s*[:：]\\s*([^~•\\n\\r]+)`, 'i');
  const directMatch = cleanText.match(directRegex);
  if (directMatch && directMatch[2] && directMatch[3]) {
    let cleanMsg = directMatch[3].trim();
    const nextSenderIndex = cleanMsg.search(/(?:\s+[A-Z][a-zA-Z0-9_@]+(?:\s+[A-Z][a-zA-Z0-9_@]+){0,2}\s*[:：])/);
    if (nextSenderIndex !== -1) {
      cleanMsg = cleanMsg.substring(0, nextSenderIndex).trim();
    }
    return {
      sender: directMatch[2].trim().replace(/^~\s*/, ''),
      message: cleanMsg
    };
  }

  // 2. Token-level targeted match (e.g. search "Akhil" matches "Akhil Jio: so yep")
  const tokens = search.split(' ').filter(t => t.length >= 3);
  for (const token of tokens) {
    const escToken = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const tokenRegex = new RegExp(`(?:^|[\\s~•\\-])(~?\\s*)((?:[a-zA-Z0-9_@]+\\s+)?${escToken}(?:\\s+[a-zA-Z0-9_@]+)?)\\s*(?:@\\s*[^:：\\n]+?)?\\s*[:：]\\s*([^~•\\n\\r]+)`, 'i');
    const tokenMatch = cleanText.match(tokenRegex);
    if (tokenMatch && tokenMatch[2] && tokenMatch[3]) {
      let cleanMsg = tokenMatch[3].trim();
      const nextSenderIndex = cleanMsg.search(/(?:\s+[A-Z][a-zA-Z0-9_@]+(?:\s+[A-Z][a-zA-Z0-9_@]+){0,2}\s*[:：])/);
      if (nextSenderIndex !== -1) {
        cleanMsg = cleanMsg.substring(0, nextSenderIndex).trim();
      }
      return {
        sender: tokenMatch[2].trim().replace(/^~\s*/, ''),
        message: cleanMsg
      };
    }
  }

  // 3. Fallback: block-by-block inspection
  const blocks = cleanText.split(/(?=[\n\r~•]|\.\s+(?:~|[A-Za-z0-9_@]+(?:\s+[A-Za-z0-9_@]+){0,3}\s*[:：]))/);
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i].replace(/^[~•\n\r\s]+/, '').trim();
    const match = block.match(/^([a-zA-Z0-9_@]+(?:\s+[a-zA-Z0-9_@]+){0,3})\s*(?:@\s*[^:：]+?)?\s*[:：]\s*(.*)$/s);
    if (match) {
      const sender = match[1].trim();
      const msg = match[2].trim();
      if (isContactMatch(sender, '', '', search)) {
        return {
          sender: sender.replace(/^~\s*/, ''),
          message: msg
        };
      }
    }
  }
  return null;
}

export {
  isContactMatch,
  extractSenderMessageFromGroup,
  normalizeContactString,
  levenshteinDistance
};

export default {
  isContactMatch,
  extractSenderMessageFromGroup,
  normalizeContactString,
  levenshteinDistance
};
