const assert = require('assert');
const { ProfanityFilter, normalize, collapse } = require('./profanity');

let tests = 0;
let failed = 0;

function test(name, fn) {
  tests++;
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed++;
    console.error(`  ✗ ${name}: ${error.message}`);
  }
}

const filter = new ProfanityFilter();

console.log('\nprofanity');

test('normalize lower-cases, de-leets and reduces separators', () => {
  assert.strictEqual(normalize('F.U.C.K'), 'f u c k');
  assert.strictEqual(normalize('@$$'), 'ass');
  assert.strictEqual(normalize(null), '');
});

test('punctuation is read both as a letter and as a separator', () => {
  // '!' is a letter in "sh!t" but mere excitement in "ass!" — hence two passes.
  assert.strictEqual(normalize('Sh1t!'), 'shiti');
  assert.strictEqual(normalize('Sh1t!', false), 'shit');
  assert.ok(filter.isProfane('sh!t'));
  assert.ok(filter.isProfane('ass!'));
  assert.ok(filter.isProfane('@ss'));
});

test('collapse removes every separator', () => {
  assert.strictEqual(collapse('f.u.c.k'), 'fuck');
});

test('plain profanity is caught', () => {
  for (const s of ['FUCK THIS', 'Ass', 'what a bitch', 'bullshit']) {
    assert.ok(filter.isProfane(s), `expected profane: ${s}`);
  }
});

test('leetspeak is caught', () => {
  assert.ok(filter.isProfane('sh1t'));
  assert.ok(filter.isProfane('n1gger'));
  assert.ok(filter.isProfane('@ss'));
});

test('separator evasion is caught', () => {
  for (const s of ['f u c k', 'f.u.c.k', 'a s s h o l e', 'tw at']) {
    assert.ok(filter.isProfane(s), `expected profane: ${s}`);
  }
});

test('innocent phrases are not flagged', () => {
  const clean = [
    'baggle bytes', 'the bass hit', 'this hitter', 'mass hitters',
    'push it chat', 'bit char', 'Class Pass', 'my password', 'Scunthorpe',
    'assist', 'cocktail hour', 'GO TO IT', 'switch on', 'shiitake night',
    'cockatoo', 'woodcock road', 'titles', 'ROOM 42', 'TABLE NIGHT',
    'C++ ROOM', 'game 1', 'hand 5 rematch',
  ];
  for (const s of clean) {
    assert.ok(!filter.isProfane(s), `false positive: ${s} -> ${filter.matches(s)}`);
  }
});

test('short nesting terms are not hunted inside words', () => {
  // 'ass' / 'cock' / 'tits' are whole-word only, by design.
  assert.deepStrictEqual(filter.matches('classic assist'), []);
  assert.ok(filter.isProfane('ass'));
});

test('matches reports the offending terms', () => {
  assert.deepStrictEqual(filter.matches('FUCK'), ['fuck']);
  assert.deepStrictEqual(filter.matches('baggle bytes'), []);
});

test('clean masks whole words', () => {
  assert.strictEqual(filter.clean('FUCK off'), '**** off');
  assert.strictEqual(filter.clean('baggle bytes'), 'baggle bytes');
});

test('custom wordlists extend the defaults', () => {
  const custom = new ProfanityFilter({
    words: ['banned'],
    strict: [],
    allow: [],
  });
  assert.ok(custom.isProfane('banned'));
  assert.ok(!custom.isProfane('fuck'), 'custom words replace, not merge');
});

test('empty and non-string input is clean, not a crash', () => {
  for (const bad of ['', '   ', null, undefined, 42, {}]) {
    assert.deepStrictEqual(filter.matches(bad), []);
  }
});

console.log(`\n${tests - failed}/${tests} passed`);
if (failed > 0) process.exit(1);
