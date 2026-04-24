/**
 * Integration test for gameMode session coordination + zip writing.
 * Runs directly as a Node script; no jest needed.
 *   node server/gameMode.test.js
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

// Point storage at a temp dir before loading the module
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gamemode-test-'));
process.env.GAME_MODE_STORAGE = tmpDir;

const { registerUpload, getSessionStatus, STORAGE_DIR, _sessions } = require('./gameMode');

let tests = 0, failed = 0;
function test(name, fn) {
  tests++;
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`  ✗ ${name}: ${e.message}`);
  }
}

console.log('gameMode');

test('STORAGE_DIR honors env var', () => {
  assert.strictEqual(STORAGE_DIR, path.resolve(tmpDir));
});

test('first upload creates a session and returns code', () => {
  _sessions.clear();
  const r = registerUpload({
    sessionCode: null,
    seat: 'dealer',
    cards: ['Ah','Kh','Qh','Jh','10h','9h','8h','7h','6h','5h','4h','3h','2h'],
    imageBuffer: Buffer.from('fake'),
    imageExt: 'png',
  });
  assert.strictEqual(r.status, 'accepted');
  assert.ok(r.session && r.session.length === 6);
  assert.deepStrictEqual(r.seatsFilled, ['dealer']);
  assert.ok(r.seatsMissing.includes('bid1'));
});

test('subsequent uploads with same code join session', () => {
  _sessions.clear();
  const first = registerUpload({
    sessionCode: 'ABCDEF',
    seat: 'dealer',
    cards: ['Ah','Kh','Qh','Jh','10h','9h','8h','7h','6h','5h','4h','3h'],
    imageBuffer: Buffer.from('a'), imageExt: 'png',
  });
  assert.strictEqual(first.status, 'accepted');

  const second = registerUpload({
    sessionCode: 'ABCDEF',
    seat: 'bid1',
    cards: ['As','Ks','Qs','Js','10s','9s','8s','7s','6s','5s','4s','3s'],
    imageBuffer: Buffer.from('b'), imageExt: 'png',
  });
  assert.strictEqual(second.status, 'accepted');
  assert.deepStrictEqual(second.seatsFilled.sort(), ['bid1','dealer']);
});

test('duplicate seat upload is rejected', () => {
  _sessions.clear();
  registerUpload({
    sessionCode: 'DUPSES', seat: 'dealer',
    cards: ['Ah','Kh','Qh','Jh','10h','9h','8h','7h','6h','5h','4h','3h'],
    imageBuffer: Buffer.from('a'), imageExt: 'png',
  });
  const dup = registerUpload({
    sessionCode: 'DUPSES', seat: 'dealer',
    cards: ['Ah','Kh','Qh','Jh','10h','9h','8h','7h','6h','5h','4h','3h'],
    imageBuffer: Buffer.from('a'), imageExt: 'png',
  });
  assert.strictEqual(dup.status, 'error');
  assert.ok(dup.errors[0].match(/already uploaded/));
});

test('invalid seat returns error', () => {
  _sessions.clear();
  const r = registerUpload({
    sessionCode: null, seat: 'left',
    cards: ['Ah'], imageBuffer: Buffer.from('a'), imageExt: 'png',
  });
  assert.strictEqual(r.status, 'error');
  assert.ok(r.errors[0].match(/Invalid seat/));
});

test('complete session writes zip and returns URL', () => {
  _sessions.clear();
  const code = 'WORKSW';
  const rank = r => r === 1 ? 'A' : r === 11 ? 'J' : r === 12 ? 'Q' : r === 13 ? 'K' : String(r);
  const build = (suitCh) => Array.from({ length: 12 }, (_, i) => `${rank(i + 1)}${suitCh}`);

  const r1 = registerUpload({ sessionCode: code, seat: 'dealer', cards: build('h'), imageBuffer: Buffer.from('image-dealer'), imageExt: 'png' });
  assert.strictEqual(r1.status, 'accepted');
  const r2 = registerUpload({ sessionCode: code, seat: 'bid1',   cards: build('s'), imageBuffer: Buffer.from('image-b1'),     imageExt: 'png' });
  assert.strictEqual(r2.status, 'accepted');
  const r3 = registerUpload({ sessionCode: code, seat: 'bid2',   cards: build('c'), imageBuffer: Buffer.from('image-b2'),     imageExt: 'png' });
  assert.strictEqual(r3.status, 'accepted');
  const r4 = registerUpload({ sessionCode: code, seat: 'bid3',   cards: build('d'), imageBuffer: Buffer.from('image-b3'),     imageExt: 'png' });
  assert.strictEqual(r4.status, 'completed');

  assert.ok(r4.url);
  assert.strictEqual(r4.url.length, 52);
  assert.strictEqual(r4.url.slice(48), '____');

  // Zip file exists
  const zipExists = fs.existsSync(r4.zipPath);
  assert.ok(zipExists, `zip missing: ${r4.zipPath}`);
  const stat = fs.statSync(r4.zipPath);
  assert.ok(stat.size > 0, 'zip is empty');

  // Session is cleared
  assert.strictEqual(getSessionStatus(code), null);
});

test('session expires cross-seat duplicate card with clear error', () => {
  _sessions.clear();
  const code = 'DUPESX';
  const rank = r => r === 1 ? 'A' : r === 11 ? 'J' : r === 12 ? 'Q' : r === 13 ? 'K' : String(r);
  const build = (suitCh) => Array.from({ length: 12 }, (_, i) => `${rank(i + 1)}${suitCh}`);

  registerUpload({ sessionCode: code, seat: 'dealer', cards: build('h'),                                           imageBuffer: Buffer.from('a'), imageExt: 'png' });
  registerUpload({ sessionCode: code, seat: 'bid1',   cards: build('s'),                                           imageBuffer: Buffer.from('b'), imageExt: 'png' });
  registerUpload({ sessionCode: code, seat: 'bid2',   cards: build('c'),                                           imageBuffer: Buffer.from('c'), imageExt: 'png' });
  // Replace a club with a heart (cross-seat dup)
  const bad = build('d'); bad[0] = 'Ah';
  const r4 = registerUpload({ sessionCode: code, seat: 'bid3', cards: bad, imageBuffer: Buffer.from('d'), imageExt: 'png' });
  assert.strictEqual(r4.status, 'error');
  assert.ok(r4.errors.some(e => /appears in both/i.test(e)), r4.errors.join('; '));
});

console.log(`\n${tests - failed}/${tests} passed`);

// Clean up temp dir
try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}

if (failed > 0) process.exit(1);
