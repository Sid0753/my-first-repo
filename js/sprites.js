/* Pixel-art rendering.
 *
 * Everything is drawn into a 640x360 buffer where one buffer pixel is one art
 * pixel, then that buffer is blown up by a whole-number factor with smoothing
 * off. So all drawing here happens on a whole-pixel grid: no curves, no
 * anti-aliasing, no fractional coordinates.
 *
 * ART converts world pixels (what the physics uses) into art pixels. At 1.0
 * they are the same, so a 40px world tile is 40 art pixels and Nandini's
 * 28x40 hitbox sits under a 42x48 sprite.
 */
const ART = 1;
const ATILE = TILE * ART;          // 40
const aw = (v) => Math.round(v * ART);

const PAL = {
  T: '#ffd84d',   // gold
  W: '#ffffff',
  g: '#6b7285',   // spike body
  l: '#aab2c4',   // spike lit edge
  n: '#3f4454',   // spike shaded edge
  I: '#ff8fb1',   // icing
  i: '#e0699a',   // icing shade
  A: '#f6d9b0',   // sponge
  a: '#e0bd8e',   // sponge shade
  C: '#7fd4ff',   // candle
  F: '#ff9a3c',   // flame
  f: '#ffd84d',   // flame core
  P: '#f2f2f7',   // plate
  p: '#c9c9d6',
  b: '#ff5f8d',   // balloon
  X: '#6b4028',   // cake chocolate
  x: '#8a5738',   // cake chocolate light
  N: '#ffd24d',   // coin
  m: '#ffef9e',   // coin highlight
  M: '#c98f18',   // coin shade
  w: '#ffd0de',   // balloon highlight
  o: '#241a2b',   // outline
};


/* 4x4 ordered dither. Used for the sky band transitions and the depth
 * falloff, which is how the reference art blends colours without gradients. */
const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

function rgbOf(hex) {
  if (hex[0] !== '#') {
    const m = hex.match(/\d+/g);
    return [+m[0], +m[1], +m[2]];
  }
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

/* Deterministic per-tile noise: the same tile always gets the same speckles,
 * so nothing crawls as the camera moves. */
function rnd(x, y, salt) {
  let n = (x * 374761393 + y * 668265263 + salt * 1274126177) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

const px = (ctx, x, y, w, h, color) => { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); };

/* A filled circle snapped to the pixel grid. */
function disc(ctx, cx, cy, r, color) {
  ctx.fillStyle = color;
  for (let y = -r; y <= r; y++) {
    const w = Math.round(Math.sqrt(r * r - y * y));
    ctx.fillRect(cx - w, cy + y, w * 2 + 1, 1);
  }
}

/* Draw once into an offscreen canvas and reuse it every frame. With outline
 * set, a 1px dark border is traced around the result so the props match the
 * character art, which is outlined the same way. */
function bake(w, h, draw, outline = true) {
  const pad = outline ? 1 : 0;
  const c = document.createElement('canvas');
  c.width = w + pad * 2;
  c.height = h + pad * 2;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.save();
  g.translate(pad, pad);
  draw(g);
  g.restore();
  if (outline) {
    const W = c.width;
    const H = c.height;
    const d = g.getImageData(0, 0, W, H).data;
    const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : d[(y * W + x) * 4 + 3]);
    const ring = [];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (at(x, y)) continue;
        if (at(x - 1, y) || at(x + 1, y) || at(x, y - 1) || at(x, y + 1)) ring.push([x, y]);
      }
    }
    g.fillStyle = PAL.o;
    for (const [x, y] of ring) g.fillRect(x, y, 1, 1);
  }
  return c;
}

/* ------------------------------------------------------------------ Nandini */

/* The character art is a spritesheet: nine 42x48 frames, feet flush with the
 * bottom of each cell. */
const SHEET = new Image();
SHEET.src = 'assets/nandini.png';
const CELL_W = 42;
const CELL_H = 48;
const FRAMES = ['idle', 'walk1', 'run1', 'walk2', 'run2', 'jump', 'fall', 'hurt', 'cheer'];
const FRAME_INDEX = Object.fromEntries(FRAMES.map((n, i) => [n, i]));
const RUN_CYCLE = ['run1', 'run2'];

function nandiniFrame(anim) {
  if (anim.victory) return 'cheer';
  if (anim.hurtFlash) return 'hurt';
  if (!anim.grounded) return anim.rising ? 'jump' : 'fall';
  if (anim.speed > 20) {
    const n = RUN_CYCLE.length;
    return RUN_CYCLE[((Math.floor(anim.runPhase) % n) + n) % n];
  }
  return 'idle';
}

/* (cx, feetY) is the bottom-centre of her hitbox, in world pixels. */
function drawNandini(ctx, cx, feetY, facing, anim) {
  if (!SHEET.complete || !SHEET.naturalWidth) return;
  const idx = FRAME_INDEX[nandiniFrame(anim)];
  const x = aw(cx) - Math.floor(CELL_W / 2);
  const y = aw(feetY) - CELL_H;
  ctx.save();
  if (facing < 0) {
    ctx.translate(x + CELL_W, y);
    ctx.scale(-1, 1);
    ctx.drawImage(SHEET, idx * CELL_W, 0, CELL_W, CELL_H, 0, 0, CELL_W, CELL_H);
  } else {
    ctx.drawImage(SHEET, idx * CELL_W, 0, CELL_W, CELL_H, x, y, CELL_W, CELL_H);
  }
  ctx.restore();
}

/* --------------------------------------------------------------- the props */

const SPR_FLOWER = bake(13, 13, (g) => {
  for (const [x, y] of [[6, 2], [10, 5], [8, 10], [4, 10], [2, 5]]) disc(g, x, y, 2, PAL.W);
  disc(g, 6, 6, 2, PAL.T);
});

/* A spent flower stays a flower, just drained of colour — a dark blob reads as
 * damage to the HUD rather than to Nandini. */
const SPR_FLOWER_OFF = bake(13, 13, (g) => {
  for (const [x, y] of [[6, 2], [10, 5], [8, 10], [4, 10], [2, 5]]) disc(g, x, y, 2, '#b9b2c6');
  disc(g, 6, 6, 2, '#8e869c');
});

/* Spinning coin: four frames, the face narrowing as it turns edge-on. */
const COIN_FRAMES = [8, 6, 3, 6].map((half) => bake(18, 18, (g) => {
  for (let y = -8; y <= 8; y++) {
    const w = Math.round(half * Math.sqrt(1 - (y * y) / 81));
    if (w <= 0) continue;
    px(g, 9 - w, 9 + y, w * 2, 1, PAL.N);
  }
  if (half >= 6) {
    for (let y = -5; y <= 5; y++) {
      const w = Math.round((half - 3) * Math.sqrt(1 - (y * y) / 36));
      if (w <= 0) continue;
      px(g, 9 - w, 9 + y, w * 2, 1, PAL.m);
    }
    px(g, 8, 5, 2, 8, PAL.M);
  }
}));
const SPR_COIN = COIN_FRAMES[0];

function balloon(color, highlight, string) {
  return bake(13, 20, (g) => {
    disc(g, 6, 6, 6, color);
    px(g, 5, 12, 3, 2, color);
    px(g, 6, 13, 1, 1, color);
    disc(g, 4, 4, 1, highlight);
    g.fillStyle = string;
    for (let i = 0; i < 6; i++) g.fillRect(6 + (i % 3 === 1 ? 1 : 0), 14 + i, 1, 1);
  });
}
const SPR_BALLOON = balloon(PAL.b, PAL.w, 'rgba(255,255,255,0.75)');
const SPR_BALLOON_OFF = balloon('#8d94a6', '#c3c9d6', 'rgba(200,200,210,0.5)');

/* Cake: chocolate tiers under pink icing with white drips, and three lit
 * candles — matching the goal cake in the design reference. */
function icingDrips(g, x, w, y, color) {
  for (let d = 0; d + 6 <= w; d += 6) {
    const h = 3 + ((d / 6) % 3);
    px(g, x + d + 1, y, 4, h, color);
    px(g, x + d + 2, y + h, 2, 1, color);
  }
}

const SPR_CAKE = bake(48, 58, (g) => {
  px(g, 2, 54, 44, 4, PAL.P);                  // plate
  px(g, 6, 52, 36, 2, PAL.p);

  px(g, 5, 36, 38, 16, PAL.X);                 // lower tier
  px(g, 5, 36, 38, 3, PAL.x);
  px(g, 4, 28, 40, 9, PAL.I);                  // lower icing
  px(g, 4, 28, 40, 2, '#ffb8cf');
  px(g, 4, 35, 40, 2, PAL.i);
  icingDrips(g, 4, 40, 37, PAL.W);

  px(g, 13, 15, 22, 13, PAL.X);                // upper tier
  px(g, 13, 15, 22, 3, PAL.x);
  px(g, 12, 8, 24, 8, PAL.I);                  // upper icing
  px(g, 12, 8, 24, 2, '#ffb8cf');
  icingDrips(g, 12, 24, 15, PAL.W);

  for (let i = 0; i < 3; i++) {                // candles
    const cx = 16 + i * 8;
    px(g, cx, 0, 3, 9, PAL.W);
    px(g, cx, 3, 3, 2, PAL.b);
  }
});

/* A pennant at the goal, so the finish reads at a glance. */
const SPR_FLAG = bake(18, 44, (g) => {
  px(g, 2, 0, 3, 44, '#d8d8e4');
  px(g, 2, 0, 1, 44, '#ffffff');
  for (let r = 0; r < 14; r++) {
    px(g, 5, 3 + r, 13 - Math.abs(r - 7), 1, r < 7 ? '#ff6ea6' : '#e8467f');
  }
});

function drawCake(ctx, x, baseY, t) {
  const bob = Math.floor(t * 2) % 2;
  const bx = aw(x) - Math.floor(SPR_CAKE.width / 2);
  const by = aw(baseY) - SPR_CAKE.height + 1 + bob;

  ctx.drawImage(SPR_FLAG, bx + SPR_CAKE.width + 2, aw(baseY) - SPR_FLAG.height + 1);
  ctx.drawImage(SPR_CAKE, bx, by);

  // three flames, flickering out of step with each other
  for (let i = 0; i < 3; i++) {
    const cx = bx + 17 + i * 8;
    const f = Math.floor(t * 8 + i * 1.7) % 3;
    px(ctx, cx - 1, by - 5 + (f === 1 ? 1 : 0), 3, 5, PAL.F);
    px(ctx, cx, by - 6 + (f === 1 ? 1 : 0), 1, 3, PAL.f);
    px(ctx, cx - 1 + (f === 2 ? 1 : 0), by - 7, 1, 1, PAL.f);
  }

  ctx.fillStyle = 'rgba(255,222,140,0.85)';
  for (let i = 0; i < 5; i++) {
    if ((Math.floor(t * 3) + i) % 4 === 0) continue;
    const a = (i / 5) * Math.PI * 2 + t * 0.7;
    ctx.fillRect(bx + 24 + Math.round(Math.cos(a) * 22), by + 6 + Math.round(Math.sin(a) * 16), 2, 2);
  }
}

function drawCoin(ctx, c, t) {
  const bob = Math.floor(t * 3 + c.seed) % 2;
  const spr = COIN_FRAMES[Math.floor(t * 7 + c.seed * 2) % COIN_FRAMES.length];
  ctx.drawImage(spr, aw(c.x) - Math.floor(spr.width / 2), aw(c.y) - Math.floor(spr.height / 2) + bob);
}

function drawCheckpoint(ctx, c, t) {
  const x = aw(c.x);
  const y = aw(c.y);
  const sway = Math.floor(t * 2 + c.x * 0.02) % 2;
  const topY = y - 52 + sway;
  ctx.fillStyle = c.active ? 'rgba(255,255,255,0.7)' : 'rgba(190,190,200,0.5)';
  for (let i = 0; i < 34; i++) ctx.fillRect(x + (i % 6 < 3 ? sway : 0), topY + 18 + i, 1, 1);
  ctx.drawImage(c.active ? SPR_BALLOON : SPR_BALLOON_OFF, x - Math.floor(SPR_BALLOON.width / 2), topY);
}

function drawFlowerIcon(ctx, x, y, filled) {
  ctx.drawImage(filled ? SPR_FLOWER : SPR_FLOWER_OFF, x, y);
}

function drawCoinIcon(ctx, x, y) {
  ctx.drawImage(SPR_COIN, x, y);
}

/* ------------------------------------------------------------------- spikes */

function drawSpikes(ctx, s) {
  const x0 = aw(s.tx);
  const y0 = aw(s.ty);
  const H = 28;
  const BASE = 17;
  for (let i = 0; i < 2; i++) {
    const cx = x0 + 10 + i * 20;
    for (let r = 0; r < H; r++) {
      const w = 1 + Math.floor((r * (BASE - 1)) / (H - 1));
      const x = cx - Math.floor(w / 2);
      const y = s.dir === 'up' ? y0 + ATILE - 1 - r : y0 + r;
      px(ctx, x - 1, y, w + 2, 1, PAL.o);          // outline
      px(ctx, x, y, w, 1, r < H * 0.35 ? PAL.l : PAL.g);
      px(ctx, x, y, 1, 1, PAL.l);
      if (w > 3) px(ctx, x + w - 1, y, 1, 1, PAL.n);
    }
  }
}

/* ------------------------------------------------------------------ terrain */

/* Tiles are baked once per level into a handful of variants, then blitted.
 * The look follows the reference art: a two-tone grass cap with a notched top
 * edge, grass dripping down into the dirt, speckled dirt, and a dark outline
 * around anything exposed. */
const TOP_VARIANTS = 5;
const FILL_VARIANTS = 4;

function bakeDirt(g, level, v) {
  px(g, 0, 0, ATILE, ATILE, level.ground);
  for (let i = 0; i < 16; i++) {
    const r = rnd(v * 13 + i, i, 3);
    const x = Math.floor(r * (ATILE - 6));
    const y = 6 + Math.floor(rnd(i, v, 5) * (ATILE - 10));
    const w = 2 + Math.floor(rnd(i, v, 7) * 3);
    px(g, x, y, w * 2, 2, rnd(i, v, 9) > 0.55 ? level.groundLight : level.groundDark);
  }
  for (let i = 0; i < 10; i++) {
    px(g, Math.floor(rnd(i, v, 11) * (ATILE - 2)), Math.floor(rnd(v, i, 13) * ATILE), 2, 2, level.groundDark);
  }
}

function bakeTopTile(level, v) {
  return bake(ATILE, ATILE, (g) => {
    bakeDirt(g, level, v);

    // notched grass line; the two outermost columns are fixed so neighbouring
    // tiles always join cleanly
    const tops = [];
    for (let x = 0; x < ATILE; x += 2) {
      const edge = x < 2 || x >= ATILE - 2;
      tops.push(edge ? 3 : 3 + (rnd(x, v, 17) > 0.55 ? 2 : 0));
    }
    tops.forEach((t, i) => {
      const x = i * 2;
      px(g, x, t, 2, 9, level.grass);
      px(g, x, t + 9, 2, 5, level.grassDark);
      px(g, x, t - 2, 2, 2, level.outline);      // outline follows the notches
    });

    // grass dripping down into the dirt
    for (let d = 0; d < 2; d++) {
      if (rnd(v, d, 19) > 0.62) continue;
      const dx = 4 + Math.floor(rnd(v, d, 23) * (ATILE - 12));
      const dh = 6 + Math.floor(rnd(v, d, 29) * 10);
      px(g, dx, 12, 5, dh, level.grassDark);
      px(g, dx, 12, 5, 2, level.grass);
    }
  }, false);
}

function bakeFillTile(level, v) {
  return bake(ATILE, ATILE, (g) => bakeDirt(g, level, v), false);
}

/* Small scenery that sits on the grass, in the spirit of the reference tileset. */
function bakeTuft(level) {
  return bake(11, 8, (g) => {
    px(g, 5, 0, 1, 8, level.grass);
    px(g, 2, 2, 1, 6, level.grass);
    px(g, 8, 2, 1, 6, level.grass);
    px(g, 3, 4, 2, 4, level.grassDark);
    px(g, 6, 4, 2, 4, level.grassDark);
    px(g, 1, 6, 9, 2, level.grassDark);
  });
}

function bakeBush(level) {
  return bake(24, 14, (g) => {
    disc(g, 7, 7, 6, level.grassDark);
    disc(g, 16, 8, 5, level.grassDark);
    disc(g, 11, 5, 5, level.grass);
    disc(g, 18, 6, 3, level.grass);
    px(g, 1, 11, 22, 3, level.grassDark);
  });
}

function bakeDaisy(level) {
  return bake(9, 11, (g) => {
    px(g, 4, 5, 1, 6, level.grassDark);
    px(g, 2, 8, 2, 1, level.grassDark);
    for (const [x, y] of [[4, 1], [2, 3], [6, 3], [3, 6], [5, 6]]) disc(g, x, y, 1, '#ffffff');
    px(g, 4, 3, 1, 1, '#ffcf3d');
  });
}


function bakeTree(level) {
  return bake(46, 54, (g) => {
    px(g, 20, 34, 7, 20, '#6b4028');
    px(g, 20, 34, 2, 20, '#8a5738');
    px(g, 17, 50, 13, 4, '#6b4028');
    disc(g, 14, 24, 11, level.grassDark);
    disc(g, 32, 25, 10, level.grassDark);
    disc(g, 23, 15, 14, level.grassDark);
    disc(g, 20, 12, 9, level.grass);
    disc(g, 31, 19, 6, level.grass);
    disc(g, 12, 21, 5, level.grass);
  });
}

function bakePine(level) {
  return bake(32, 50, (g) => {
    px(g, 13, 38, 6, 12, '#6b4028');
    for (let i = 0; i < 3; i++) {
      const top = 4 + i * 11;
      const halfMax = 7 + i * 4;
      for (let r = 0; r < 14; r++) {
        const hw = 2 + Math.round((r / 13) * halfMax);
        px(g, 16 - hw, top + r, hw * 2, 1, r < 5 ? level.grass : level.grassDark);
      }
    }
  });
}

function levelArt(level) {
  if (level._art) return level._art;
  const a = {
    top: Array.from({ length: TOP_VARIANTS }, (_, v) => bakeTopTile(level, v)),
    fill: Array.from({ length: FILL_VARIANTS }, (_, v) => bakeFillTile(level, v)),
    tuft: bakeTuft(level),
    bush: bakeBush(level),
    daisy: bakeDaisy(level),
    tree: bakeTree(level),
    pine: bakePine(level),
  };
  level._art = a;
  return a;
}

function drawTerrain(ctx, level, cam, buf) {
  const art = levelArt(level);
  const rows = level.rows;
  const solid = (x, y) => x >= 0 && x < level.cols && y >= 0 && y < level.rowCount && rows[y][x] === '#';

  const x0 = Math.max(0, Math.floor(cam.x / TILE) - 1);
  const x1 = Math.min(level.cols - 1, Math.ceil((cam.x + buf.w / ART) / TILE));
  const y0 = Math.max(0, Math.floor(cam.y / TILE) - 1);
  const y1 = Math.min(level.rowCount - 1, Math.ceil((cam.y + buf.h / ART) / TILE));

  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (!solid(tx, ty)) continue;
      const x = tx * ATILE;
      const y = ty * ATILE;
      const open = !solid(tx, ty - 1);
      if (open) ctx.drawImage(art.top[Math.floor(rnd(tx, ty, 2) * TOP_VARIANTS) % TOP_VARIANTS], x, y);
      else ctx.drawImage(art.fill[Math.floor(rnd(tx, ty, 4) * FILL_VARIANTS) % FILL_VARIANTS], x, y);

      if (!solid(tx - 1, ty)) px(ctx, x, y, 2, ATILE, level.outline);
      if (!solid(tx + 1, ty)) px(ctx, x + ATILE - 2, y, 2, ATILE, level.outline);
      if (!solid(tx, ty + 1)) px(ctx, x, y + ATILE - 2, ATILE, 2, level.outline);
      if (!open && !solid(tx, ty - 1)) px(ctx, x, y, ATILE, 2, level.outline);

      // Scenery, only where the tile above is genuinely empty. Trees need a
      // couple of clear tiles overhead so a canopy never swallows a platform.
      if (open && ty > 0 && rows[ty - 1][tx] === '.') {
        const r = rnd(tx, ty, 31);
        const roomy = ty > 1 &&
          rows[ty - 1][tx - 1] === '.' && rows[ty - 1][tx + 1] === '.' &&
          rows[ty - 2][tx] === '.' && rows[ty - 2][tx - 1] === '.' && rows[ty - 2][tx + 1] === '.';
        if (r > 0.94 && roomy) ctx.drawImage(art.tree, x - 3, y - art.tree.height + 6);
        else if (r > 0.90 && roomy) ctx.drawImage(art.pine, x + 4, y - art.pine.height + 6);
        else if (r > 0.82) ctx.drawImage(art.bush, x + 6, y - art.bush.height + 5);
        else if (r > 0.62) ctx.drawImage(art.tuft, x + 4 + Math.floor(rnd(tx, ty, 37) * 18), y - art.tuft.height + 5);
        else if (r > 0.54) ctx.drawImage(art.daisy, x + 8 + Math.floor(rnd(tx, ty, 41) * 16), y - art.daisy.height + 5);
      }
    }
  }
}

/* --------------------------------------------------------------- background */

function mixHex(a, b, t) {
  const pa = rgbOf(a);
  const pb = rgbOf(b);
  const c = pa.map((v, i) => Math.round(v + (pb[i] - v) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

/* The sky is banded, with each band dithered into the next and a halftone dot
 * pattern over the top — the two things that make the reference skies read as
 * 8-bit rather than as a gradient. Baked once per level. */
function bakeSky(level, w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  const img = g.createImageData(w, h);
  const d = img.data;

  const BANDS = 7;
  const bandH = h / BANDS;
  const DITH = Math.round(bandH * 0.75);   // wide, so the blend is the feature
  const cols = [];
  for (let i = 0; i < BANDS; i++) cols.push(rgbOf(mixHex(level.sky[0], level.sky[1], i / (BANDS - 1))));
  const dots = cols.map((col) => col.map((v) => Math.min(255, Math.round(v + (255 - v) * 0.18))));

  for (let y = 0; y < h; y++) {
    const bi = Math.min(BANDS - 1, Math.floor(y / bandH));
    const toNext = (bi + 1) * bandH - y;
    for (let x = 0; x < w; x++) {
      let ci = bi;
      // 2x2 dither cells: the reference art blends in chunky blocks, not
      // single pixels
      if (bi < BANDS - 1 && toNext <= DITH &&
          BAYER[(y >> 1) & 3][(x >> 1) & 3] < (1 - toNext / DITH) * 16) ci = bi + 1;
      let col = cols[ci];
      if (((x >> 1) & 3) === 1 && ((y >> 1) & 3) === 1 && y < h * 0.85) col = dots[ci];
      const o = (y * w + x) * 4;
      d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2]; d[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

/* Chunky cumulus: white body, lit top edge, shaded flat underside. */
function bakeCloud(blobs, w, h, body, shade) {
  return bake(w, h, (g) => {
    for (const [x, y, r] of blobs) disc(g, x, y, r, body);
    const img = g.getImageData(0, 0, w, h);
    const d = img.data;
    for (let x = 0; x < w; x++) {
      let bottom = -1;
      for (let y = h - 1; y >= 0; y--) if (d[(y * w + x) * 4 + 3]) { bottom = y; break; }
      if (bottom < 0) continue;
      g.fillStyle = shade;
      g.fillRect(x, Math.max(0, bottom - 2), 1, 3);
      let top = 0;
      for (let y = 0; y < h; y++) if (d[(y * w + x) * 4 + 3]) { top = y; break; }
      g.fillStyle = '#ffffff';
      g.fillRect(x, top, 1, 1);
    }
  }, false);
}

const CLOUD_SHAPES = [
  [[[16, 22, 9], [30, 16, 13], [48, 21, 10], [62, 24, 7], [40, 26, 12]], 76, 34],
  [[[12, 14, 7], [24, 10, 9], [37, 14, 7]], 48, 22],
  [[[9, 9, 6], [19, 7, 7], [28, 10, 5]], 36, 16],
];

function levelClouds(level) {
  if (!level._clouds) {
    const body = mixHex('#ffffff', level.sky[0], 0.1);
    const shade = mixHex(body, level.sky[0], 0.42);
    level._clouds = CLOUD_SHAPES.map(([blobs, w, h]) => bakeCloud(blobs, w, h, body, shade));
  }
  return level._clouds;
}

/* The dark falloff under the horizon, so gaps in the floor read as real drops
 * and not as more hillside. Dithered, and baked once. */
const SCRIM = (() => {
  const w = 640;
  const h = 200;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  const img = g.createImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    const dens = Math.min(1, Math.pow(y / h, 1.1) * 1.75);
    for (let x = 0; x < w; x++) {
      if (BAYER[y & 3][x & 3] >= dens * 16) continue;
      const o = (y * w + x) * 4;
      d[o] = 14; d[o + 1] = 8; d[o + 2] = 26; d[o + 3] = 178;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
})();

function drawBackground(ctx, level, cam, buf, t) {
  if (!level._sky) level._sky = bakeSky(level, buf.w, buf.h);
  ctx.drawImage(level._sky, 0, 0);

  const camX = cam.x * ART;
  const camY = cam.y * ART;

  const clouds = levelClouds(level);
  const cloudCount = level.title ? 5 : 12;
  for (let i = 0; i < cloudCount; i++) {
    const spr = clouds[i % clouds.length];
    const span = buf.w + 700;
    const bx = Math.round(((i * 431) % span) - ((camX * 0.22) % span));
    const by = level.title
      ? 6 + ((i * 29) % 30)                       // kept above the title text
      : Math.round(18 + ((i * 97) % 120) - camY * 0.1);
    if (bx < -spr.width || bx > buf.w) continue;
    ctx.drawImage(spr, bx, by);
  }

  const horizon = Math.round(buf.h - 96 - camY * 0.08);

  // Distance is faked by mixing each layer toward the sky colour rather than
  // by drawing it translucent: overlapping shapes at partial alpha pile up
  // into fog.
  const haze = (c, k) => mixHex(c, level.sky[1], k);

  ctx.fillStyle = haze(level.hillBack, 0.5);
  for (let x = 0; x < buf.w; x += 4) {
    const wx = x + camX * 0.32;
    const y = horizon - Math.round((Math.sin(wx * 0.0055) * 46 + Math.sin(wx * 0.0145) * 16) / 4) * 4;
    ctx.fillRect(x, y, 4, buf.h - y);
  }

  // Near foliage: a solid band with bushy bumps along its top edge, the way
  // the reference background closes off the horizon.
  const base = horizon + 20;
  const near = haze(level.hill, 0.24);
  const nearLit = haze(level.grass, 0.3);
  ctx.fillStyle = near;
  ctx.fillRect(0, base + 8, buf.w, buf.h - base - 8);
  const shift = camX * 0.5;
  const first = Math.floor((shift - 40) / 15);
  for (let k = 0; k < buf.w / 15 + 6; k++) {
    const idx = first + k;
    const sx = Math.round(idx * 15 - shift);
    const r = 8 + Math.floor(rnd(idx, 0, 51) * 13);
    const dy = Math.floor(rnd(idx, 1, 53) * 9);
    disc(ctx, sx, base + dy, r, near);
    if (rnd(idx, 2, 57) > 0.45) disc(ctx, sx - 2, base + dy - 2, Math.max(2, r - 5), nearLit);
  }

  // Depth falloff, dithered rather than smoothly blended, so gaps in the floor
  // read as real drops and not as more hillside. Baked once — doing this per
  // pixel per frame is far too slow.
  const scrimTop = horizon + 14;
  ctx.drawImage(SCRIM, 0, scrimTop);
  const solidFrom = scrimTop + SCRIM.height;
  if (solidFrom < buf.h) px(ctx, 0, solidFrom, buf.w, buf.h - solidFrom, 'rgba(14,8,26,0.7)');

  if (level.title) return;

  const buntY = Math.round(58 - camY * 0.16);
  const flags = ['#ff6b9d', '#ffd84d', '#6ad1c8', '#b48cff'];
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  for (let x = 0; x < buf.w; x += 2) {
    const y = buntY + Math.round(Math.abs(Math.sin((x + camX * 0.45) * 0.009)) * 10);
    ctx.fillRect(x, y, 2, 2);
  }
  for (let i = 0; i < 18; i++) {
    const fx = Math.round(i * 48 - ((camX * 0.45) % 48));
    if (fx < -16 || fx > buf.w + 16) continue;
    const fy = buntY + Math.round(Math.abs(Math.sin((fx + camX * 0.45) * 0.009)) * 10);
    ctx.fillStyle = PAL.o;
    for (let r = 0; r < 11; r++) ctx.fillRect(fx - 6 + Math.floor(r / 2), fy + 2 + r, 12 - r, 1);
    ctx.fillStyle = flags[i % flags.length];
    for (let r = 0; r < 9; r++) ctx.fillRect(fx - 4 + Math.floor(r / 2), fy + 3 + r, 9 - r, 1);
  }
}

/* A chunky bordered box for HUD panels and overlay cards. */
function pixelPanel(ctx, x, y, w, h, fill = 'rgba(24,16,38,0.88)', border = '#f7e9f2') {
  px(ctx, x + 2, y, w - 4, h, fill);
  px(ctx, x, y + 2, w, h - 4, fill);
  px(ctx, x + 2, y, w - 4, 2, border);
  px(ctx, x + 2, y + h - 2, w - 4, 2, border);
  px(ctx, x, y + 2, 2, h - 4, border);
  px(ctx, x + w - 2, y + 2, 2, h - 4, border);
}
