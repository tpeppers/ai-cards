/**
 * Runs every test file under server/ in turn.
 *
 * The server tests are plain node scripts using assert (not Jest, which
 * react-scripts scopes to src/), so this just shells out to each in sequence
 * and fails if any of them do.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SERVER_DIR = path.join(ROOT, 'server');

function findTests(dir) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'engine' || entry.name === 'node_modules') continue;
      found.push(...findTests(full));
    } else if (entry.name.endsWith('.test.js')) {
      found.push(full);
    }
  }
  return found.sort();
}

const tests = findTests(SERVER_DIR);
const failures = [];

for (const file of tests) {
  const rel = path.relative(ROOT, file);
  const result = spawnSync(process.execPath, [file], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  if (result.status !== 0) failures.push(rel);
}

console.log(`\n${tests.length - failures.length}/${tests.length} server test files passed`);
if (failures.length > 0) {
  console.error(`Failed: ${failures.join(', ')}`);
  process.exit(1);
}
