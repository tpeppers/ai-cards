/**
 * Bundles src/simulation/runTrumpLeanOptimizer.ts into a Node-executable
 * script and runs it. Arguments after `--` are forwarded to the optimizer.
 *
 * Example:
 *   node scripts/trump-lean-optimize.js -- --gens 12 --hands 2000 --pop 16
 */
const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const ENTRY = path.join(ROOT, 'src', 'simulation', 'runTrumpLeanOptimizer.ts');
const OUT_DIR = path.join(ROOT, 'build-scripts');
const OUT = path.join(OUT_DIR, 'trump-lean-optimize.bundle.js');

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
  console.log('Bundling trump-lean optimizer...');
  await build();
  console.log(`Bundle ready: ${OUT}`);

  // Forward any args after `--` (or all extra args) to the optimizer entry
  // by mutating process.argv before requiring the bundle.
  const rawArgs = process.argv.slice(2);
  const sepIdx = rawArgs.indexOf('--');
  const forwarded = sepIdx >= 0 ? rawArgs.slice(sepIdx + 1) : rawArgs;
  process.argv = [process.argv[0], OUT, ...forwarded];

  require(OUT);
}

main().catch((err) => {
  console.error('Failed to run trump-lean optimizer:', err);
  process.exit(1);
});
