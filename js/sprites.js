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
  G: '#4ec9c1',   // gift teal
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

const SPR_FLOWER_OFF = bake(13, 13, (g) => {
  for (const [x, y] of [[6, 2], [10, 5], [8, 10], [4, 10], [2, 5]]) disc(g, x, y, 2, '#5b4a68');
  disc(g, 6, 6, 2, '#3f3348');
});

const SPR_GIFT = bake(16, 16, (g) => {
  px(g, 1, 5, 14, 11, PAL.G);            // box
  px(g, 1, 5, 14, 1, '#7ee0d9');         // lid highlight
  px(g, 1, 15, 14, 1, '#2f9e97');
  px(g, 6, 5, 4, 11, PAL.T);             // vertical ribbon
  px(g, 1, 9, 14, 3, PAL.T);             // horizontal ribbon
  disc(g, 4, 3, 2, PAL.T);               // bow
  disc(g, 11, 3, 2, PAL.T);
  px(g, 6, 2, 4, 3, '#ffe98a');
});

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

/* Cake: three tiers, scalloped icing, a candle on top. 40x48, base at bottom. */
const SPR_CAKE = bake(40, 48, (g) => {
  const tiers = [
    { w: 36, y: 34 },
    { w: 28, y: 22 },
    { w: 18, y: 12 },
  ];
  px(g, 1, 45, 38, 3, PAL.P);            // plate
  px(g, 3, 47, 34, 1, PAL.p);
  for (const t of tiers) {
    const x = 20 - t.w / 2;
    px(g, x, t.y, t.w, 12, PAL.A);       // sponge
    px(g, x, t.y + 9, t.w, 3, PAL.a);
    px(g, x, t.y, t.w, 4, PAL.I);        // icing band
    for (let d = 0; d + 4 <= t.w; d += 4) disc(g, x + d + 2, t.y + 4, 2, PAL.I);
    px(g, x, t.y, t.w, 1, '#ffb8cf');
    px(g, x, t.y + 6, t.w, 1, PAL.i);
    px(g, x, t.y + 7, t.w, 1, '#c9a878');
  }
  // sprinkles
  for (const [sx, sy] of [[10, 30], [16, 40], [26, 39], [30, 30], [14, 19], [24, 20]]) {
    px(g, sx, sy, 2, 1, PAL.T);
  }
  px(g, 18, 2, 4, 11, PAL.C);            // candle
  px(g, 18, 6, 4, 2, PAL.W);
});

function drawCake(ctx, x, baseY, t) {
  const bob = Math.floor(t * 2) % 2;
  const bx = aw(x) - Math.floor(SPR_CAKE.width / 2);
  const by = aw(baseY) - SPR_CAKE.height + 1 + bob;
  ctx.drawImage(SPR_CAKE, bx, by);
  // flame, animated so the candle never looks static
  const flick = Math.floor(t * 9) % 3;
  disc(ctx, bx + 20, by - 1 + (flick === 1 ? 1 : 0), 2, PAL.F);
  px(ctx, bx + 19 + (flick === 2 ? 1 : 0), by - 5, 2, 4, PAL.F);
  px(ctx, bx + 20, by - 3, 1, 3, PAL.f);
  // twinkles instead of a soft glow, which would blur the pixels
  ctx.fillStyle = 'rgba(255,222,140,0.85)';
  for (let i = 0; i < 4; i++) {
    if ((Math.floor(t * 3) + i) % 4 === 0) continue;
    const a = (i / 4) * Math.PI * 2 + t * 0.7;
    ctx.fillRect(bx + 20 + Math.round(Math.cos(a) * 15), by + 2 + Math.round(Math.sin(a) * 12), 1, 1);
  }
}

function drawGift(ctx, g, t) {
  const bob = Math.floor(t * 3 + g.seed) % 2;
  ctx.drawImage(SPR_GIFT, aw(g.x) - Math.floor(SPR_GIFT.width / 2), aw(g.y) - Math.floor(SPR_GIFT.height / 2) + bob);
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

function drawGiftIcon(ctx, x, y) {
  ctx.drawImage(SPR_GIFT, x, y);
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
      px(ctx, x, y, w, 1, PAL.g);
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

function levelArt(level) {
  if (level._art) return level._art;
  const a = {
    top: Array.from({ length: TOP_VARIANTS }, (_, v) => bakeTopTile(level, v)),
    fill: Array.from({ length: FILL_VARIANTS }, (_, v) => bakeFillTile(level, v)),
    tuft: bakeTuft(level),
    bush: bakeBush(level),
    daisy: bakeDaisy(level),
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

      // scenery, only where the tile above is genuinely empty
      if (open && ty > 0 && rows[ty - 1][tx] === '.') {
        const r = rnd(tx, ty, 31);
        if (r > 0.86) ctx.drawImage(art.bush, x + 6, y - art.bush.height + 5);
        else if (r > 0.66) ctx.drawImage(art.tuft, x + 4 + Math.floor(rnd(tx, ty, 37) * 18), y - art.tuft.height + 5);
        else if (r > 0.58) ctx.drawImage(art.daisy, x + 8 + Math.floor(rnd(tx, ty, 41) * 16), y - art.daisy.height + 5);
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
  const DITH = 12;
  const cols = [];
  for (let i = 0; i < BANDS; i++) cols.push(rgbOf(mixHex(level.sky[0], level.sky[1], i / (BANDS - 1))));
  const dots = cols.map((col) => col.map((v) => Math.min(255, Math.round(v + (255 - v) * 0.18))));

  for (let y = 0; y < h; y++) {
    const bi = Math.min(BANDS - 1, Math.floor(y / bandH));
    const toNext = (bi + 1) * bandH - y;
    for (let x = 0; x < w; x++) {
      let ci = bi;
      if (bi < BANDS - 1 && toNext <= DITH && BAYER[y & 3][x & 3] < (1 - toNext / DITH) * 16) ci = bi + 1;
      let col = cols[ci];
      if (x % 4 === 1 && y % 4 === 1 && y < h * 0.8) col = dots[ci];
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
  for (let i = 0; i < 12; i++) {
    const spr = clouds[i % clouds.length];
    const span = buf.w + 700;
    const bx = Math.round(((i * 431) % span) - ((camX * 0.22) % span));
    const by = Math.round(18 + ((i * 97) % 120) - camY * 0.1);
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
