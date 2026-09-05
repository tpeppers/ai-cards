/**
 * Profanity gate for anything that can leave the container.
 *
 * Room codes are free text typed by whoever shows up, and player names are
 * self-chosen, so both are screened before the Signal announcer posts them to
 * a group. This is deliberately dependency-free and conservative: it is a
 * politeness filter on outbound messages, not a moderation system.
 *
 * Three passes, each narrow enough to keep innocent phrases clean:
 *   1. token pass    — normalized words matched whole; catches ordinary use.
 *   2. in-token pass — STRICT terms as a substring of a single token, so
 *      "bullshit" is caught but "this hitter" is not.
 *   3. evasion pass  — STRICT terms across a run of 1-2 character tokens, the
 *      "f u c k" / "f.u.c.k" signature. Deliberately does NOT collapse the
 *      whole string: doing so flags "the bass hit" and "mass hitters".
 *
 * The wordlist can be extended at runtime from a JSON file (see loadWordlist)
 * so operators can tune it without a rebuild.
 */

const fs = require('fs');

// Terms matched as whole words after normalization.
const DEFAULT_WORDS = [
  'anus', 'arse', 'ass', 'asshole', 'bastard', 'bitch', 'bollocks', 'boner',
  'bullshit', 'clit', 'cock', 'coon', 'crap', 'cunt', 'dick', 'dildo', 'dyke',
  'fag', 'faggot', 'fuck', 'fucker', 'fucking', 'goddamn', 'handjob', 'jizz',
  'kike', 'motherfucker', 'nigga', 'nigger', 'paki', 'pussy', 'queer', 'retard',
  'rimjob', 'shit', 'shithead', 'slut', 'spic', 'tits', 'titties', 'twat',
  'wank', 'wanker', 'whore',
];

// Terms also hunted with separators stripped, to catch "f-u-c-k" style
// evasion. Kept to unambiguous strings that don't nest inside common words.
const DEFAULT_STRICT = [
  'cunt', 'fuck', 'nigger', 'nigga', 'faggot', 'kike', 'motherfucker', 'whore',
  'shit', 'bitch', 'dildo', 'rimjob', 'handjob', 'asshole', 'twat', 'wanker',
];
// Note: short, heavily-nesting terms ('ass', 'cock', 'tits') are deliberately
// NOT strict — they'd fire inside 'class', 'cockatoo', 'titles'. The whole-word
// pass already catches them when used as words.

// Innocent words that would otherwise trip the collapse pass.
const DEFAULT_ALLOW = [
  'class', 'classic', 'bass', 'brass', 'glass', 'grass', 'pass', 'password',
  'passphrase', 'mass', 'massive', 'assist', 'assign', 'asset', 'assess',
  'embassy', 'cassandra', 'shitake', 'shiitake', 'scunthorpe', 'sussex',
  'analysis', 'analyst', 'canal', 'cockpit', 'cocktail', 'peacock', 'shuttlecock',
  'dickens', 'titan', 'title', 'competition', 'constitution', 'substitute',
];

// Digits always stand in for letters.
const LEET_DIGITS = {
  '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b',
};
// Punctuation is ambiguous: '!' is a letter in "sh!t" but plain excitement in
// "ass!". matches() therefore tries the text both ways.
const LEET_PUNCT = {
  '@': 'a', '$': 's', '!': 'i', '|': 'i', '+': 't',
};

const LEET = { ...LEET_DIGITS, ...LEET_PUNCT };

/**
 * Lower-case, de-leet, and reduce to letters plus single spaces.
 *
 * @param {boolean} leetPunct when false, '@ $ ! | +' are treated as
 *   separators instead of letters.
 */
function normalize(text, leetPunct = true) {
  if (typeof text !== 'string') return '';
  const table = leetPunct ? LEET : LEET_DIGITS;
  const deLeet = text
    .toLowerCase()
    .split('')
    .map(ch => (Object.prototype.hasOwnProperty.call(table, ch) ? table[ch] : ch))
    .join('');
  return deLeet.replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Same as normalize but with every separator removed. */
function collapse(text) {
  return normalize(text).replace(/[^a-z0-9]/g, '');
}

class ProfanityFilter {
  constructor({ words, strict, allow } = {}) {
    this.words = new Set((words || DEFAULT_WORDS).map(w => w.toLowerCase()));
    this.strict = (strict || DEFAULT_STRICT).map(w => w.toLowerCase());
    this.allow = new Set((allow || DEFAULT_ALLOW).map(w => w.toLowerCase()));
  }

  /**
   * @returns {string[]} the terms that matched; empty when the text is clean.
   */
  matches(text) {
    const hits = new Set();
    // Punctuation is ambiguous, so scan both readings and union the hits:
    // the leet reading catches "sh!t", the separator reading catches "ass!".
    for (const leetPunct of [true, false]) {
      this._scan(normalize(text, leetPunct), hits);
    }
    return [...hits];
  }

  /** Run the three passes over one normalized reading, adding to `hits`. */
  _scan(normalized, hits) {
    if (!normalized) return;

    const tokens = normalized.split(' ').filter(Boolean);

    // 1. Whole-word pass.
    for (const token of tokens) {
      if (this.allow.has(token)) continue;
      if (this.words.has(token)) hits.add(token);
    }

    // 2. In-token pass: a strict term buried inside one word.
    for (const token of tokens) {
      if (this.allow.has(token)) continue;
      for (const term of this.strict) {
        if (token.includes(term)) hits.add(term);
      }
    }

    // 3. Evasion pass: strict terms spelled out across a run of very short
    // tokens ("f u c k", "f.u.c.k"). Joining only these runs — rather than
    // the whole string — is what keeps "the bass hit" clean.
    let run = [];
    const flushRun = () => {
      if (run.length >= 2) {
        const squashed = run.join('');
        for (const term of this.strict) {
          if (squashed.includes(term)) hits.add(term);
        }
      }
      run = [];
    };
    for (const token of tokens) {
      if (token.length <= 2) run.push(token);
      else flushRun();
    }
    flushRun();
  }

  isProfane(text) {
    return this.matches(text).length > 0;
  }

  /**
   * Replace matched words with asterisks.
   *
   * Word-by-word, so it does NOT mask separator evasion ("f u c k" survives) —
   * use isProfane() to block such text outright. clean() is for softening
   * incidental language, not for defeating a determined evader.
   */
  clean(text, mask = '*') {
    if (typeof text !== 'string') return '';
    return text.replace(/[A-Za-z0-9@$!|+]+/g, word =>
      this.isProfane(word) ? mask.repeat(Math.max(3, word.length)) : word
    );
  }
}

/**
 * Build a filter, optionally merging an operator-supplied JSON file of the
 * shape { words: [], strict: [], allow: [] }. Missing or malformed files fall
 * back to the defaults rather than throwing — a bad wordlist must not stop the
 * server from booting.
 */
function loadWordlist(filePath) {
  if (!filePath) return new ProfanityFilter();
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return new ProfanityFilter({
      words: [...DEFAULT_WORDS, ...(Array.isArray(raw.words) ? raw.words : [])],
      strict: [...DEFAULT_STRICT, ...(Array.isArray(raw.strict) ? raw.strict : [])],
      allow: [...DEFAULT_ALLOW, ...(Array.isArray(raw.allow) ? raw.allow : [])],
    });
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn(`[profanity] ignoring ${filePath}: ${error.message}`);
    }
    return new ProfanityFilter();
  }
}

module.exports = {
  ProfanityFilter,
  loadWordlist,
  normalize,
  collapse,
  DEFAULT_WORDS,
  DEFAULT_STRICT,
  DEFAULT_ALLOW,
};
