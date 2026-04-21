/**
 * Bundles src/simulation/runHandPowerSweep.ts and runs it.
 *
 * Examples:
 *   node scripts/sweep-hand-power.js
 *   node scripts/sweep-hand-power.js -- --hands 800 --pool 300
 *   node scripts/sweep-hand-power.js -- --sigs 9,11,13 --trusts 3,5 --opp 99,9
 */
const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const ENTRY = path.join(ROOT, 'src', 'simulation', 'runHandPowerSweep.ts');
const OUT_DIR = path.join(ROOT, 'build-scripts');
const OUT = path.join(OUT_DIR, 'sweep-hand-power.bundle.js');

async function build() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  await esbuild.build({
    entryPoints: [ENTRY],
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    outfile: OUT,
    sourcemap: 'inline',
    loader: {
      '.tsx': 'tsx',
      '.ts': 'ts',
      '.js': 'jsx',
    },
    define: {
      'process.env.NODE_ENV': '"production"',
    },
  });
}

async function main() {
  console.log('Bundling hand_power sweep...');
  await build();

  const rawArgs = process.argv.slice(2);
  const sepIdx = rawArgs.indexOf('--');
  const forwarded = sepIdx >= 0 ? rawArgs.slice(sepIdx + 1) : rawArgs;
  process.argv = [process.argv[0], OUT, ...forwarded];

  require(OUT);
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
