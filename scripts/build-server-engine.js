/**
 * Bundles the Bid Whist engine for Node so the multiplayer server can be
 * authoritative — it deals, validates every move and drives the bots using
 * the same code the browser runs.
 *
 * Mirrors scripts/build-standalone.js, but emits CommonJS for platform node
 * instead of a browser IIFE.
 *
 * Output: server/engine/bundle.cjs (a build artifact; not checked in).
 */

const esbuild = require('esbuild');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT_FILE = path.join(ROOT, 'server', 'engine', 'bundle.cjs');

async function build() {
  console.log('Bundling server engine...');
  await esbuild.build({
    entryPoints: [path.join(ROOT, 'src', 'multiplayer', 'serverEntry.ts')],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node18',
    outfile: OUT_FILE,
    // Keep it readable: this runs server-side, so bytes don't matter and a
    // legible stack trace does.
    minify: false,
    sourcemap: false,
    logLevel: 'info',
    loader: {
      '.ts': 'ts',
      '.tsx': 'tsx',
      '.js': 'jsx',
    },
    define: {
      'process.env.NODE_ENV': '"production"',
    },
  });

  console.log(`Server engine written to ${path.relative(ROOT, OUT_FILE)}`);
}

build().catch(err => {
  console.error(err);
  process.exit(1);
});
