const fs = require('fs');

// Helper functions from redTeamDecks.ts
function cl(suit, rank) {
  const bases = { H: 97, S: 110, C: 65, D: 78 };
  return String.fromCharCode(bases[suit] + rank - 1);
}

function cards(suit) {
  const ranks = Array.prototype.slice.call(arguments, 1);
  return ranks.map(r => cl(suit, r)).join('');
}

function allSuits() {
  const ranks = Array.prototype.slice.call(arguments);
  return ['H','S','C','D'].map(s => cards.apply(null, [s].concat(ranks))).join('');
}

function buildDeck(s, e, n, w, k) {
  let url = '';
  for (let i = 0; i < 12; i++) url += s[i] + e[i] + n[i] + w[i];
  return url + k;
}

function fill(ps, pe, pn, pw, pk) {
  const ref = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  const used = new Set((ps + pe + pn + pw + pk).split(''));
  const rem = ref.split('').filter(c => !used.has(c));
  let s = ps, e = pe, n = pn, w = pw, k = pk;
  let i = 0;
  while (s.length < 12) s += rem[i++];
  while (e.length < 12) e += rem[i++];
  while (n.length < 12) n += rem[i++];
  while (w.length < 12) w += rem[i++];
  while (k.length < 4) k += rem[i++];
  return { s, e, n, w, k };
}

function decodeChar(c) {
  const code = c.charCodeAt(0);
  const rn = {1:'A',2:'2',3:'3',4:'4',5:'5',6:'6',7:'7',8:'8',9:'9',10:'10',11:'J',12:'Q',13:'K'};
  if (code >= 97 && code <= 109) return 'H' + rn[code - 96];
  if (code >= 110 && code <= 122) return 'S' + rn[code - 109];
  if (code >= 65 && code <= 77) return 'C' + rn[code - 64];
  if (code >= 78 && code <= 90) return 'D' + rn[code - 77];
  return '?' + c + '(' + code + ')';
}

function splitArgs(block) {
  const args = [];
  let depth = 0;
  let current = '';
  let inString = false;
  let stringChar = '';
  const BACKSLASH = String.fromCharCode(92);
  for (let i = 0; i < block.length; i++) {
    const c = block[i];
    if (inString) {
      current += c;
      if (c === BACKSLASH) { i++; if (i < block.length) current += block[i]; }
      else if (c === stringChar) { inString = false; }
      continue;
    }
    if (c === String.fromCharCode(39) || c === String.fromCharCode(34) || c === String.fromCharCode(96)) {
      inString = true;
      stringChar = c;
      current += c;
      continue;
    }
    if (c === '(' || c === '[') { depth++; current += c; continue; }
    if (c === ')' || c === ']') { depth--; current += c; continue; }
    if (c === ',' && depth === 0) { args.push(current.trim()); current = ''; continue; }
    current += c;
  }
  if (current.trim()) args.push(current.trim());
  return args;
}

function evalCardExpr(expr) {
  expr = expr.replace(/\/\/[^\n]*/g, '').trim();
  if (expr === String.fromCharCode(39,39) || expr === String.fromCharCode(34,34) || expr === String.fromCharCode(96,96)) return '';
  try {
    const result = eval(expr);
    if (typeof result === 'string') return result;
    return String(result);
  } catch(e) {
    throw new Error('Cannot evaluate: ' + expr + ' -- ' + e.message);
  }
}

function evalStringArg(expr) {
  expr = expr.replace(/\/\/[^\n]*/g, '').trim();
  try { return eval(expr); } catch(e) { return expr; }
}

// Read file
const source = fs.readFileSync('C:/code/ai-cards/src/simulation/redTeamDecks.ts', 'utf-8');
const pushPattern = /D\.push\((mk(?:Auto)?)\(([\s\S]*?)\)\);/g;

let match;
let deckIndex = 0;
const failures = [];
let total = 0;

while ((match = pushPattern.exec(source)) !== null) {
  total++;
  deckIndex++;
  const funcName = match[1];
  const argsBlock = match[2];
  const lineNum = source.substring(0, match.index).split(String.fromCharCode(10)).length;
  const args = splitArgs(argsBlock);
  if (args.length < 7) {
    failures.push({ index: deckIndex, error: 'Expected 7 args, got ' + args.length, lineNum });
    continue;
  }
  try {
    const sVal = evalCardExpr(args[0]);
    const eVal = evalCardExpr(args[1]);
    const nVal = evalCardExpr(args[2]);
    const wVal = evalCardExpr(args[3]);
    const kVal = evalCardExpr(args[4]);
    const desc = evalStringArg(args[6]);
    let finalS = sVal, finalE = eVal, finalN = nVal, finalW = wVal, finalK = kVal;
    if (funcName === 'mkAuto') {
      const filled = fill(sVal, eVal, nVal, wVal, kVal);
      finalS = filled.s; finalE = filled.e; finalN = filled.n; finalW = filled.w; finalK = filled.k;
    }
    const handErrors = [];
    if (finalS.length !== 12) handErrors.push('S=' + finalS.length);
    if (finalE.length !== 12) handErrors.push('E=' + finalE.length);
    if (finalN.length !== 12) handErrors.push('N=' + finalN.length);
    if (finalW.length !== 12) handErrors.push('W=' + finalW.length);
    if (finalK.length !== 4) handErrors.push('K=' + finalK.length);
    let url;
    if (finalS.length >= 12 && finalE.length >= 12 && finalN.length >= 12 && finalW.length >= 12) {
      url = buildDeck(finalS, finalE, finalN, finalW, finalK);
    } else {
      url = finalS + finalE + finalN + finalW + finalK;
    }
    const ref = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    const refSorted = ref.split('').sort().join('');
    const urlSorted = url.split('').sort().join('');
    if (url.length !== 52 || urlSorted !== refSorted) {
      const counts = {};
      url.split('').forEach(c => { counts[c] = (counts[c] || 0) + 1; });
      const urlSet = new Set(url.split(''));
      const missing = ref.split('').filter(c => !urlSet.has(c));
      const dupes = [];
      for (const ch in counts) { if (counts[ch] > 1) dupes.push(ch + '(x' + counts[ch] + ')'); }
      failures.push({
        index: deckIndex, desc, funcName, totalLen: url.length, lineNum,
        handLens: 'S=' + finalS.length + ' E=' + finalE.length + ' N=' + finalN.length + ' W=' + finalW.length + ' K=' + finalK.length,
        missing: missing.map(c => c + '=' + decodeChar(c)),
        dupes: dupes.map(d => d + '=' + decodeChar(d[0])),
        handErrors
      });
    }
  } catch (err) {
    failures.push({ index: deckIndex, error: 'Eval error: ' + err.message, raw: argsBlock.substring(0, 200), lineNum });
  }
}

console.log('Total decks found: ' + total);
console.log('Valid decks: ' + (total - failures.length));
console.log('Invalid decks: ' + failures.length);
console.log('');
if (failures.length > 0) {
  console.log('=== FAILURES ===');
  console.log('');
  failures.forEach(f => {
    console.log('Deck #' + f.index + ' (line ' + (f.lineNum || '?') + '): ' + (f.desc || '(no desc)'));
    if (f.error) {
      console.log('  ERROR: ' + f.error);
      if (f.raw) console.log('  Raw: ' + f.raw);
    } else {
      console.log('  Function: ' + f.funcName);
      console.log('  Total length: ' + f.totalLen + ' (expected 52)');
      console.log('  Hand lengths: ' + f.handLens);
      if (f.handErrors.length > 0) console.log('  Hand size errors: ' + f.handErrors.join(', '));
      if (f.missing.length > 0) console.log('  Missing cards: ' + f.missing.join(', '));
      if (f.dupes.length > 0) console.log('  Duplicate cards: ' + f.dupes.join(', '));
    }
    console.log('');
  });
} else {
  console.log('All decks are valid!');
}
