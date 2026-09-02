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
function bake(w, h, draw, outline = true, outlineColor = PAL.o) {
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
    g.fillStyle = outlineColor;
    for (const [x, y] of ring) g.fillRect(x, y, 1, 1);
  }
  return c;
}

/* ------------------------------------------------------------------ Nandini */

/* The character art is a spritesheet: nine 42x48 frames, feet flush with the
 * bottom of each cell. */
/* Asset paths go through one lookup so a single-file build can swap them for
 * inlined data URIs without touching the rest of the code. */
const ASSET_URLS = (typeof window !== 'undefined' && window.ASSET_URLS) || {};
const assetUrl = (name) => ASSET_URLS[name] || `assets/${name}.png`;

const SHEET = new Image();
SHEET.src = assetUrl('nandini');
const FRAMES = ['idle', 'blink', 'wave', 'kiss', 'walk1', 'run1', 'walk2', 'run2',
                'jump', 'fall', 'hurt', 'cheer'];
const FRAME_INDEX = Object.fromEntries(FRAMES.map((n, i) => [n, i]));
const RUN_CYCLE = ['run1', 'run2'];
let CELL_W = 42;
let CELL_H = 48;

/* Left alone, she blinks every few seconds and, after a longer wait, waves or
 * blows a kiss — so standing still never looks like a frozen screen. */
function idlePose(t) {
  if (t > 6) {
    const since = t - 6;
    if (since % 8 < 1.4) return Math.floor(since / 8) % 2 ? 'kiss' : 'wave';
  }
  const b = t % 3.4;
  if (b < 0.13 || (b > 0.26 && b < 0.39)) return 'blink';   // a double blink
  return 'idle';
}

function nandiniFrame(anim) {
  if (anim.victory) return 'cheer';
  if (anim.hurtFlash) return 'hurt';
  if (!anim.grounded) return anim.rising ? 'jump' : 'fall';
  if (anim.speed > 20) {
    const n = RUN_CYCLE.length;
    return RUN_CYCLE[((Math.floor(anim.runPhase) % n) + n) % n];
  }
  return idlePose(anim.idleTime || 0);
}

/* (cx, feetY) is the bottom-centre of her hitbox, in world pixels. */
function drawNandini(ctx, cx, feetY, facing, anim) {
  if (!SHEET.complete || !SHEET.naturalWidth) return;
  CELL_W = SHEET.naturalWidth / FRAMES.length;
  CELL_H = SHEET.naturalHeight;

  const pose = nandiniFrame(anim);
  const idx = FRAME_INDEX[pose];
  // a slow breath while she stands, so the sprite is never perfectly still
  const breath = (pose === 'idle' || pose === 'blink') && ((anim.idleTime || 0) % 1.8) > 0.9 ? -1 : 0;
  const x = aw(cx) - Math.floor(CELL_W / 2);
  const y = aw(feetY) - CELL_H + breath;
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

/* Spinning coin, eight frames through a full turn.
 *
 * The width follows a cosine, so the face narrows to an edge and opens out
 * again at the physically right rate. What actually sells the rotation is the
 * highlight: it sweeps across the face and leans the other way once the far
 * side comes round, and the edge-on frames show a milled rim. Without those
 * cues a symmetric widen/narrow just reads as a throb. */
const COIN_OUT = '#7d4a10';
const COIN_RIM = '#dc9a17';
const COIN_FACE = '#ffcf33';
const COIN_LIGHT = '#ffe886';
const COIN_SHINE = '#fffbe4';

/* Chamfered rather than round: the reference coin is a chunky octagon. */
function coinRowHalf(y, hw) {
  const a = Math.abs(y);
  if (a > 8) return 0;
  return Math.max(1, hw - Math.max(0, a - 4));
}

function bakeCoinFrame(step) {
  const turn = Math.cos((step * Math.PI) / 4);
  const hw = Math.max(1, Math.round(8 * Math.abs(turn)));
  const back = turn < 0;
  const CX = 10;
  const CY = 10;
  return bake(20, 20, (g) => {
    for (let y = -8; y <= 8; y++) {
      const w = coinRowHalf(y, hw);
      px(g, CX - w, CY + y, w * 2, 1, COIN_RIM);
    }

    if (hw <= 2) {                       // edge on: a milled rim
      for (let y = -7; y <= 7; y += 3) px(g, CX - hw, CY + y, hw * 2, 1, COIN_OUT);
      px(g, CX - hw, CY - 8, 1, 17, COIN_LIGHT);
      return;
    }

    for (let y = -7; y <= 7; y++) {      // face
      const w = Math.max(1, coinRowHalf(y, hw) - 2);
      px(g, CX - w, CY + y, w * 2, 1, COIN_FACE);
    }
    if (hw >= 6) {
      for (let y = -4; y <= 4; y++) {
        const w = Math.max(1, coinRowHalf(y, hw) - 4);
        px(g, CX - w, CY + y, w * 2, 1, COIN_LIGHT);
      }
    }

    const lean = back ? -1 : 1;          // highlight sweeps the other way
    for (let k = 0; k <= 8; k++) {
      const y = k - 4;
      const w = coinRowHalf(y, hw) - 2;
      if (w < 1) continue;
      const want = CX - lean * Math.round((k - 4) * 0.85) - 1;
      const x = Math.max(CX - w, Math.min(CX + w - 2, want));
      px(g, x, CY + y, 2, 1, COIN_SHINE);
    }
  }, true, COIN_OUT);
}

const COIN_FRAMES = Array.from({ length: 8 }, (_, i) => bakeCoinFrame(i));
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
  const spr = COIN_FRAMES[Math.floor(t * 11 + c.seed * 3) % COIN_FRAMES.length];
  ctx.drawImage(spr, aw(c.x) - Math.floor(spr.width / 2), aw(c.y) - Math.floor(spr.height / 2));
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

/* The gold selector arrow on the game-over menu. */
const SPR_ARROW = bake(10, 11, (g) => {
  for (let r = 0; r < 11; r++) {
    const w = Math.round(10 - Math.abs(r - 5) * 2);
    if (w > 0) px(g, 0, r, w, 1, PAL.T);
  }
  px(g, 0, 4, 4, 3, '#fff0b0');
});

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
const TOP_VARIANTS = 8;
const FILL_VARIANTS = 6;

/* Dirt in the reference tileset is banded, not noisy: a lighter upper layer
 * under the grass, darker below, with a scatter of chunks for texture. */
function bakeDirt(g, level, v) {
  px(g, 0, 0, ATILE, ATILE, level.ground);
  px(g, 0, Math.round(ATILE * 0.55), ATILE, ATILE, level.groundDark);
  for (let i = 0; i < 9; i++) {
    const x = Math.floor(rnd(v * 13 + i, i, 3) * (ATILE - 8));
    const y = 4 + Math.floor(rnd(i, v, 5) * (ATILE - 10));
    const w = 3 + Math.floor(rnd(i, v, 7) * 4);
    const below = y > ATILE * 0.55;
    px(g, x, y, w * 2, 3, below ? level.ground : level.groundLight);
  }
  for (let i = 0; i < 6; i++) {
    px(g, Math.floor(rnd(i, v, 11) * (ATILE - 3)), Math.floor(rnd(v, i, 13) * ATILE), 3, 2, level.groundDark);
  }
}

/* The notched grass cap, shared by the solid and the floating tile. The two
 * outermost columns are fixed so neighbouring tiles always join cleanly. */
function grassCap(g, level, v) {
  for (let x = 0; x < ATILE; x += 2) {
    const edge = x < 2 || x >= ATILE - 2;
    const t = edge ? 3 : 3 + (rnd(x, v, 17) > 0.55 ? 2 : 0);
    px(g, x, t, 2, 9, level.grass);
    px(g, x, t + 9, 2, 5, level.grassDark);
    px(g, x, t - 2, 2, 2, level.outline);
  }
  for (let d = 0; d < 2; d++) {
    if (rnd(v, d, 19) > 0.62) continue;
    const dx = 4 + Math.floor(rnd(v, d, 23) * (ATILE - 12));
    const dh = 6 + Math.floor(rnd(v, d, 29) * 10);
    px(g, dx, 12, 5, dh, level.grassDark);
    px(g, dx, 12, 5, 2, level.grass);
  }
}

function bakeTopTile(level, v) {
  return bake(ATILE, ATILE, (g) => {
    bakeDirt(g, level, v);
    grassCap(g, level, v);
  }, false);
}

/* A ledge with nothing under it gets a ragged, tapering underside instead of a
 * ruled line — the floating platform in the reference hangs rather than sits. */
function bakeFloatTile(level, v) {
  return bake(ATILE, ATILE, (g) => {
    bakeDirt(g, level, v);
    grassCap(g, level, v);

    const STEP = 8;
    const cuts = [];
    for (let x = 0; x < ATILE; x += STEP) cuts.push(2 + Math.round(rnd(x, v, 71) * 5));
    g.globalCompositeOperation = 'destination-out';
    cuts.forEach((c, i) => g.fillRect(i * STEP, ATILE - c, STEP, c));
    g.globalCompositeOperation = 'source-over';

    g.fillStyle = level.outline;
    cuts.forEach((c, i) => {
      const y = ATILE - c;
      g.fillRect(i * STEP, y - 2, STEP, 2);
      const next = cuts[i + 1];
      if (next === undefined) return;
      const ny = ATILE - next;
      if (ny !== y) g.fillRect(i * STEP + STEP - 2, Math.min(y, ny) - 2, 2, Math.abs(ny - y) + 2);
    });
  }, false);
}

function bakeFillTile(level, v) {
  return bake(ATILE, ATILE, (g) => bakeDirt(g, level, v), false);
}

/* Scenery, built to match the reference tileset: two-tone foliage with lighter
 * patches up and to the left, a dark outline on everything, and chunky forms
 * that read at a glance. Foliage takes the level's own greens, so the same
 * shapes work on the day, rose and dusk levels. */

function bakeTree(level) {
  return bake(58, 66, (g) => {
    // trunk, flaring into roots at the base
    px(g, 25, 38, 9, 28, level.ground);
    px(g, 25, 38, 3, 28, level.groundLight);
    px(g, 22, 60, 15, 6, level.ground);
    px(g, 20, 63, 19, 3, level.ground);
    px(g, 33, 44, 2, 16, level.groundDark);

    for (const [x, y, r] of [[29, 26, 21], [14, 32, 14], [44, 32, 14], [29, 15, 16]]) {
      disc(g, x, y, r, level.grassDark);
    }
    for (const [x, y, r] of [[21, 17, 10], [38, 22, 8], [13, 29, 7], [30, 11, 7]]) {
      disc(g, x, y, r, level.grass);
    }
  });
}

function bakePine(level) {
  return bake(40, 58, (g) => {
    px(g, 16, 44, 8, 14, level.ground);
    px(g, 16, 44, 3, 14, level.groundLight);
    for (let i = 0; i < 3; i++) {
      const top = 3 + i * 14;
      const half = 8 + i * 5;
      for (let r = 0; r < 17; r++) {
        const hw = 2 + Math.round((r / 16) * half);
        px(g, 20 - hw, top + r, hw * 2, 1, r < 5 ? level.grass : level.grassDark);
      }
    }
  });
}

function bakeBushBig(level) {
  return bake(36, 22, (g) => {
    for (const [x, y, r] of [[10, 13, 9], [25, 14, 8], [17, 9, 9]]) disc(g, x, y, r, level.grassDark);
    for (const [x, y, r] of [[13, 8, 5], [26, 10, 4]]) disc(g, x, y, r, level.grass);
    px(g, 2, 18, 32, 4, level.grassDark);
  });
}

function bakeBushSmall(level) {
  return bake(24, 15, (g) => {
    for (const [x, y, r] of [[8, 9, 6], [16, 10, 5], [12, 6, 6]]) disc(g, x, y, r, level.grassDark);
    disc(g, 10, 5, 3, level.grass);
    px(g, 2, 12, 20, 3, level.grassDark);
  });
}

function bakeTuft(level) {
  return bake(17, 18, (g) => {
    const blades = [[0, 9], [4, 3], [8, 0], [12, 5]];
    for (const [x, top] of blades) {
      px(g, x, top, 2, 18 - top, level.grassDark);
      px(g, x, top, 2, Math.max(2, Math.round((18 - top) / 2)), level.grass);
    }
    px(g, 2, 16, 11, 2, level.grassDark);
  });
}

function petalFlower(g, cx, cy, petal, core) {
  for (const [dx, dy] of [[0, -3], [3, -1], [2, 3], [-2, 3], [-3, -1]]) disc(g, cx + dx, cy + dy, 2, petal);
  disc(g, cx, cy, 1, core);
}

function bakeDaisy(level) {
  return bake(11, 15, (g) => {
    px(g, 5, 6, 1, 9, level.grassDark);
    px(g, 2, 10, 3, 1, level.grassDark);
    px(g, 6, 12, 3, 1, level.grassDark);
    petalFlower(g, 5, 4, '#ffffff', '#ffcf3d');
  });
}

function bakeDaisyCluster(level) {
  return bake(24, 16, (g) => {
    px(g, 2, 11, 20, 5, level.grassDark);
    for (const [x, y] of [[5, 10], [12, 8], [19, 11]]) {
      px(g, x, y, 1, 6, level.grassDark);
      petalFlower(g, x, y - 2, '#ffffff', '#ffcf3d');
    }
  });
}

function bakeBlueFlower(level) {
  return bake(12, 16, (g) => {
    px(g, 6, 7, 1, 9, level.grassDark);
    px(g, 2, 11, 4, 1, level.grassDark);
    px(g, 7, 13, 4, 1, level.grassDark);
    petalFlower(g, 6, 5, '#3f86e0', '#ffcf3d');
    disc(g, 5, 4, 1, '#6aa8f2');
  });
}

function bakeMushroom() {
  return bake(17, 18, (g) => {
    px(g, 6, 10, 5, 8, '#e8d5b0');       // stem
    px(g, 6, 10, 2, 8, '#cbb894');
    for (let r = 0; r < 10; r++) {       // cap: narrow at the crown, wide at the brim
      const hw = Math.round(Math.sqrt(Math.max(0, 1 - Math.pow((9 - r) / 10, 2))) * 8);
      px(g, 8 - hw, 1 + r, hw * 2 + 1, 1, r > 7 ? '#2f66aa' : '#3b7fd4');
    }
    disc(g, 5, 5, 2, '#8fc2f5');
    disc(g, 11, 7, 1, '#8fc2f5');
  });
}

function bakeLog(level) {
  return bake(32, 15, (g) => {
    px(g, 5, 2, 26, 11, level.ground);
    px(g, 5, 2, 26, 3, level.groundLight);
    px(g, 5, 10, 26, 3, level.groundDark);
    for (let x = 10; x < 30; x += 6) px(g, x, 6, 4, 1, level.groundDark);
    for (let r = 0; r < 11; r++) {        // cut end, with rings
      const hw = Math.round(Math.sqrt(1 - ((r - 5) / 5.5) ** 2) * 5);
      px(g, 5 - hw, 2 + r, hw * 2 + 1, 1, level.groundLight);
    }
    disc(g, 5, 7, 3, level.ground);
    disc(g, 5, 7, 1, level.groundDark);
  });
}

function bakeSnail() {
  return bake(20, 14, (g) => {
    px(g, 2, 10, 14, 4, '#d8b37a');      // foot
    px(g, 13, 4, 4, 7, '#d8b37a');       // head
    px(g, 15, 0, 1, 5, '#c89a5b');       // antennae
    px(g, 18, 1, 1, 4, '#c89a5b');
    disc(g, 8, 7, 6, '#c08a4a');         // shell
    disc(g, 8, 7, 4, '#d8a866');
    disc(g, 8, 7, 2, '#a9743a');
    px(g, 8, 3, 1, 4, '#a9743a');
  });
}

function levelArt(level) {
  if (level._art) return level._art;
  const a = {
    top: Array.from({ length: TOP_VARIANTS }, (_, v) => bakeTopTile(level, v)),
    fill: Array.from({ length: FILL_VARIANTS }, (_, v) => bakeFillTile(level, v)),
    float: Array.from({ length: TOP_VARIANTS }, (_, v) => bakeFloatTile(level, v)),
    tree: bakeTree(level),
    pine: bakePine(level),
    bushBig: bakeBushBig(level),
    bushSmall: bakeBushSmall(level),
    tuft: bakeTuft(level),
    daisy: bakeDaisy(level),
    cluster: bakeDaisyCluster(level),
    blueFlower: bakeBlueFlower(level),
    mushroom: bakeMushroom(),
    log: bakeLog(level),
    snail: bakeSnail(),
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
      const hanging = open && !solid(tx, ty + 1);
      const v = Math.floor(rnd(tx, ty, 2) * TOP_VARIANTS) % TOP_VARIANTS;
      if (hanging) ctx.drawImage(art.float[v], x, y);
      else if (open) ctx.drawImage(art.top[v], x, y);
      else ctx.drawImage(art.fill[Math.floor(rnd(tx, ty, 4) * FILL_VARIANTS) % FILL_VARIANTS], x, y);

      if (!solid(tx - 1, ty)) px(ctx, x, y, 2, ATILE, level.outline);
      if (!solid(tx + 1, ty)) px(ctx, x + ATILE - 2, y, 2, ATILE, level.outline);
      if (!hanging && !solid(tx, ty + 1)) px(ctx, x, y + ATILE - 2, ATILE, 2, level.outline);

      // Scenery, only where the tile above is genuinely empty. Trees need a
      // couple of clear tiles overhead so a canopy never swallows a platform.
      if (open && ty > 0 && rows[ty - 1][tx] === '.') {
        const r = rnd(tx, ty, 31);
        const roomy = ty > 1 &&
          rows[ty - 1][tx - 1] === '.' && rows[ty - 1][tx + 1] === '.' &&
          rows[ty - 2][tx] === '.' && rows[ty - 2][tx - 1] === '.' && rows[ty - 2][tx + 1] === '.';
        const jitter = (span) => x + Math.floor(rnd(tx, ty, 37) * span);
        const sit = (spr, sx) => ctx.drawImage(spr, sx, y - spr.height + 5);
        if (r > 0.955 && roomy) sit(art.tree, x - 8);
        else if (r > 0.925 && roomy) sit(art.pine, x + 2);
        else if (r > 0.885) sit(art.bushBig, x + 3);
        else if (r > 0.845) sit(art.bushSmall, x + 8);
        else if (r > 0.815) sit(art.log, x + 5);
        else if (r > 0.790) sit(art.mushroom, jitter(20));
        else if (r > 0.768) sit(art.snail, jitter(18));
        else if (r > 0.720) sit(art.cluster, x + 8);
        else if (r > 0.648) sit(art.daisy, jitter(26));
        else if (r > 0.575) sit(art.blueFlower, jitter(24));
        else if (r > 0.440) sit(art.tuft, jitter(22));
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

/* The skies are painted images, one per level, scaled to the buffer width.
 * They are drawn twice — once normally, once mirrored — so the slow horizontal
 * parallax never runs off the end or shows a seam. */
const SKY_CACHE = {};
function skyImage(name) {
  if (!SKY_CACHE[name]) {
    const img = new Image();
    img.src = assetUrl(name);
    SKY_CACHE[name] = img;
  }
  return SKY_CACHE[name];
}
['sky-day', 'sky-rose', 'sky-dusk'].forEach(skyImage);

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
  const camX = cam.x * ART;
  const camY = cam.y * ART;

  const sky = skyImage(level.skyImage);
  if (sky.complete && sky.naturalWidth) {
    const sw = sky.naturalWidth;
    const ox = Math.round(camX * 0.16) % sw;
    const oy = Math.round(Math.min(Math.max(0, sky.naturalHeight - buf.h), camY * 0.12));
    ctx.drawImage(sky, 0, oy, sw, buf.h, -ox, 0, sw, buf.h);
    ctx.save();
    ctx.translate(-ox + sw * 2, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(sky, 0, oy, sw, buf.h, 0, 0, sw, buf.h);
    ctx.restore();
  } else {
    px(ctx, 0, 0, buf.w, buf.h, level.sky[0]);
  }

  const horizon = Math.round(buf.h - 96 - camY * 0.08);

  // Distance is faked by mixing each layer toward the sky colour rather than
  // by drawing it translucent: overlapping shapes at partial alpha pile up
  // into fog.
  const haze = (c, k) => mixHex(c, level.sky[1], k);

  const farShift = camX * 0.3;
  const farFirst = Math.floor((farShift - 40) / 19);
  for (let k = 0; k < buf.w / 19 + 6; k++) {
    const idx = farFirst + k;
    const sx = Math.round(idx * 19 - farShift);
    const r = 10 + Math.floor(rnd(idx, 0, 61) * 12);
    const dy = Math.floor(rnd(idx, 1, 67) * 10);
    disc(ctx, sx, horizon + 14 + dy, r, haze(level.hillBack, 0.45));
  }
  ctx.fillStyle = haze(level.hillBack, 0.45);
  ctx.fillRect(0, horizon + 22, buf.w, buf.h - horizon - 22);

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

  // Clamped so the bunting never drifts up over the flowers and level name.
  const buntY = Math.max(36, Math.round(58 - camY * 0.16));
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
