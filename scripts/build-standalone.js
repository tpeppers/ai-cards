const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'standalone', 'bidwhist');
const ANIMATIONS_SRC = path.join(ROOT, 'public', 'animations');
const ANIMATIONS_DST = path.join(OUT_DIR, 'animations');

async function build() {
  // Clean and create output directory
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // Bundle with esbuild
  console.log('Bundling game.js...');
  await esbuild.build({
    entryPoints: [path.join(ROOT, 'src', 'standalone-bidwhist.tsx')],
    bundle: true,
    format: 'iife',
    outfile: path.join(OUT_DIR, 'game.js'),
    minify: true,
    treeShaking: true,
    target: 'es2020',
    jsx: 'automatic',
    loader: {
      '.tsx': 'tsx',
      '.ts': 'ts',
      '.js': 'jsx',
      '.css': 'css',
    },
    define: {
      'process.env.NODE_ENV': '"production"',
    },
    // Ignore Node-only / server modules
    external: [
      'fs', 'path', 'child_process', 'os', 'crypto', 'stream', 'http',
      'https', 'net', 'tls', 'zlib', 'events', 'url', 'util', 'buffer',
      'querystring', 'assert',
    ],
  });

  // Fix absolute /animations/ paths to relative ./animations/
  console.log('Fixing animation paths...');
  let js = fs.readFileSync(path.join(OUT_DIR, 'game.js'), 'utf8');
  js = js.replace(/["']\/animations\//g, (match) => {
    const quote = match[0];
    return `${quote}./animations/`;
  });
  fs.writeFileSync(path.join(OUT_DIR, 'game.js'), js);

  // Generate index.html
  console.log('Writing index.html...');
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bid Whist</title>
  <script src="https://cdn.tailwindcss.com"><\/script>
</head>
<body class="bg-gray-900">
  <div id="root"></div>
  <script src="game.js"><\/script>
</body>
</html>`;
  fs.writeFileSync(path.join(OUT_DIR, 'index.html'), html);

  // Copy animation files
  if (fs.existsSync(ANIMATIONS_SRC)) {
    console.log('Copying animations...');
    fs.mkdirSync(ANIMATIONS_DST, { recursive: true });
    const files = fs.readdirSync(ANIMATIONS_SRC);
    let copied = 0;
    for (const file of files) {
      if (file.endsWith('.webp')) {
        fs.copyFileSync(
          path.join(ANIMATIONS_SRC, file),
          path.join(ANIMATIONS_DST, file)
        );
        copied++;
      }
    }
    console.log(`  Copied ${copied} animation files`);
  } else {
    console.warn('Warning: public/animations/ not found, skipping animation copy');
  }

  // Report sizes
  const jsSize = fs.statSync(path.join(OUT_DIR, 'game.js')).size;
  console.log(`\nBuild complete!`);
  console.log(`  Output: ${OUT_DIR}`);
  console.log(`  game.js: ${(jsSize / 1024).toFixed(1)} KB`);
  console.log(`\nTo test: serve the standalone/bidwhist/ folder with any static server`);
}

build().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
