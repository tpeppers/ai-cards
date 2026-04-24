const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const ENTRY = path.join(ROOT, 'src', 'simulation', 'runGameLengthDiag.ts');
const OUT_DIR = path.join(ROOT, 'build-scripts');
const OUT = path.join(OUT_DIR, 'game-length-diag.bundle.js');

async function build() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  await esbuild.build({
    entryPoints: [ENTRY], bundle: true, platform: 'node', target: 'node18',
    format: 'cjs', outfile: OUT, sourcemap: 'inline',
    loader: { '.tsx': 'tsx', '.ts': 'ts', '.js': 'jsx' },
    define: { 'process.env.NODE_ENV': '"production"' },
  });
}

async function main() {
  console.log('Bundling...');
  await build();
  require(OUT);
}

main().catch(err => { console.error('Failed:', err); process.exit(1); });
