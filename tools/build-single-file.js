#!/usr/bin/env node
/* Bundle the game into one self-contained HTML file.
 *
 * The stylesheet and every script are inlined, and the PNGs become data URIs,
 * so the result runs from a file:// double-click, from any static host, or
 * pasted into a page that supplies its own <head>.
 *
 *   node tools/build-single-file.js
 *
 * Writes dist/nandini-birthday-run.html (a complete document) and
 * dist/nandini-birthday-run.fragment.html (no <html>/<head>/<body>, for hosts
 * that wrap the content themselves).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const SCRIPTS = ['js/levels.js', 'js/sprites.js', 'js/input.js', 'js/audio.js', 'js/game.js'];
const IMAGES = ['nandini', 'sky-day', 'sky-rose', 'sky-dusk'];

const FONT_LINK =
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap">';

const assetMap = Object.fromEntries(IMAGES.map((name) => [
  name,
  'data:image/png;base64,' + fs.readFileSync(path.join(ROOT, 'assets', `${name}.png`)).toString('base64'),
]));

const body = `<style>
${read('css/style.css').trim()}
</style>

<div id="stage">
  <canvas id="game" width="640" height="360" aria-label="Nandini's Birthday Run game screen"></canvas>

  <div id="touch-controls" aria-hidden="true">
    <div class="pad">
      <button id="btn-left" class="tbtn" type="button">&#9664;</button>
      <button id="btn-right" class="tbtn" type="button">&#9654;</button>
    </div>
    <button id="btn-jump" class="tbtn jump" type="button">JUMP</button>
  </div>
</div>

<p id="footnote">ARROWS / A-D MOVE &middot; SPACE JUMP &middot; R RESTART &middot; M MUTE</p>

<script>
window.ASSET_URLS = ${JSON.stringify(assetMap)};
</script>
${SCRIPTS.map((f) => `<script>\n${read(f).trim()}\n</script>`).join('\n')}`;

const doc = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<title>Nandini's Birthday Run</title>
<meta name="description" content="A little 2D platformer made as a birthday present. Help Nandini reach the cake.">
<meta name="theme-color" content="#2b1f3a">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><text y='26' font-size='26'>&#127874;</text></svg>">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
${FONT_LINK}
</head>
<body>
${body}
</body>
</html>
`;

const fragment = `<title>Nandini's Birthday Run</title>
${FONT_LINK}
${body}
`;

fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'dist/nandini-birthday-run.html'), doc);
fs.writeFileSync(path.join(ROOT, 'dist/nandini-birthday-run.fragment.html'), fragment);
const kb = (p) => Math.round(fs.statSync(path.join(ROOT, p)).size / 1024);
console.log(`dist/nandini-birthday-run.html          ${kb('dist/nandini-birthday-run.html')} KB`);
console.log(`dist/nandini-birthday-run.fragment.html ${kb('dist/nandini-birthday-run.fragment.html')} KB`);
