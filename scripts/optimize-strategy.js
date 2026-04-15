/**
 * Bundles src/simulation/runOptimizer.ts into a Node-executable script
 * and runs it. Arguments after `--` are forwarded to the optimizer.
 *
 * Example:
 *   node scripts/optimize-strategy.js -- --gens 30 --hands 500 --pop 20
 */
const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const ENTRY = path.join(ROOT, 'src', 'simulation', 'runOptimizer.ts');
const OUT_DIR = path.join(ROOT, 'build-scripts');
const OUT = path.join(OUT_DIR, 'optimize-strategy.bundle.js');

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
  console.log('Bundling optimizer...');
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
  console.error('Failed to run optimizer:', err);
  process.exit(1);
});
