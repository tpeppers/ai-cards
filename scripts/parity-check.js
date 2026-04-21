/**
 * Bundles src/simulation/runStrategyParity.ts into a Node-executable
 * script and runs it.
 *
 * Example:
 *   node scripts/parity-check.js -- --pool 500 --hands 2000
 *   node scripts/parity-check.js -- --pair "Family,Claude" --hands 1000
 */
const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const ENTRY = path.join(ROOT, 'src', 'simulation', 'runStrategyParity.ts');
const OUT_DIR = path.join(ROOT, 'build-scripts');
const OUT = path.join(OUT_DIR, 'parity-check.bundle.js');

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
  console.log('Bundling parity check...');
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
