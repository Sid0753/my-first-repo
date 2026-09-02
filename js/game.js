/* Nandini's Birthday Run — main loop, physics and game states. */

// The game is drawn as pixel art into a small buffer, then blown up by whole
// pixels onto the visible canvas. BUF is the art resolution; ART (in
// sprites.js) converts world pixels to art pixels.
const BUF = { w: 640, h: 360 };
// Text is laid out in a fixed 960x540 space and scaled to whatever integer
// zoom the window allows, so the copy never has to move.
const VIEW = { w: 960, h: 540 };
const A2T = VIEW.w / BUF.w;      // art pixels -> text-space pixels
const WORLD_VIEW = { w: BUF.w / ART, h: BUF.h / ART };
let SCALE = 0;   // art pixels -> css pixels, always a whole number (0 = not laid out yet)
let DPR = 1;
let STORE = 1;   // whole-number scale of the backing store
let TURNED = null;

// Movement constants. The level maps in levels.js are designed against these:
// a full jump clears 131px (3 tiles) of height and about 190px of distance.
const GRAVITY = 2200;
const JUMP_V = 760;
const RUN_SPEED = 280;
const GROUND_ACCEL = 2400;
const AIR_ACCEL = 1500;
const GROUND_FRICTION = 2600;
const MAX_FALL = 1600;
const COYOTE_TIME = 0.11;      // still jumpable just after walking off a ledge
const JUMP_BUFFER = 0.14;      // a jump pressed just before landing still counts
const JUMP_CUT = 0.45;         // releasing jump early shortens the hop
const HARD_LAND_V = 1350;      // landing faster than this hurts (~10 tiles of fall)
const MAX_HP = 5;
const INVULN_TIME = 1.3;

const PLAYER_W = 28;
const PLAYER_H = 40;

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

// The pixel-art buffer. Everything is drawn here first, at 320x180.
const buffer = document.createElement('canvas');
buffer.width = BUF.w;
buffer.height = BUF.h;
const bctx = buffer.getContext('2d');

const FONT = '"Press Start 2P", "Courier New", monospace';

const state = {
  mode: 'title',          // title | intro | play | hurtReset | dead | clear | win
  levelIndex: 0,
  level: null,
  player: null,
  cam: { x: 0, y: 0 },
  shake: 0,
  time: 0,
  modeTime: 0,
  particles: [],
  coinsThisLevel: 0,
  coinsTotal: 0,
  unlocked: 1,
};

/* ---------------------------------------------------------------- progress */

const SAVE_KEY = 'nandini-birthday-run';
function loadProgress() {
  try {
    const raw = JSON.parse(localStorage.getItem(SAVE_KEY) || '{}');
    state.unlocked = Math.min(LEVELS.length, Math.max(1, raw.unlocked || 1));
  } catch (e) { state.unlocked = 1; }
}
function saveProgress() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ unlocked: state.unlocked }));
  } catch (e) { /* private browsing — progress just won't persist */ }
}

/* ------------------------------------------------------------------ helpers */

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const playerRect = (p) => ({ x: p.x - PLAYER_W / 2, y: p.y - PLAYER_H, w: PLAYER_W, h: PLAYER_H });

function spawnParticles(x, y, count, opts) {
  for (let i = 0; i < count; i++) {
    const a = opts.angle !== undefined ? opts.angle + (Math.random() - 0.5) * (opts.spread || 1) : Math.random() * Math.PI * 2;
    const sp = (opts.speed || 120) * (0.4 + Math.random() * 0.8);
    state.particles.push({
      x, y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      life: opts.life || 0.6,
      maxLife: opts.life || 0.6,
      size: opts.size || 3,
      color: Array.isArray(opts.color) ? opts.color[(Math.random() * opts.color.length) | 0] : opts.color,
      gravity: opts.gravity === undefined ? 900 : opts.gravity,
      spin: (Math.random() - 0.5) * 10,
      rot: Math.random() * 6.28,
      shape: opts.shape || 'dot',
    });
  }
}

/* --------------------------------------------------------------- level flow */

function startLevel(index) {
  state.levelIndex = index;
  state.level = buildLevel(LEVELS[index]);
  state.coinsThisLevel = 0;
  state.particles.length = 0;
  const L = state.level;
  state.player = {
    x: L.spawn.x,
    y: L.spawn.y,
    vx: 0,
    vy: 0,
    facing: 1,
    grounded: false,
    coyote: 0,
    buffer: 0,
    hp: MAX_HP,
    invuln: 0,
    runPhase: 0,
    idleTime: 0,
    respawn: { x: L.spawn.x, y: L.spawn.y },
    fadeIn: 0,
  };
  centerCamera(true);
  setMode('intro');
}

function setMode(mode) {
  state.mode = mode;
  state.modeTime = 0;
}

function centerCamera(snap) {
  const p = state.player;
  const L = state.level;
  const tx = clamp(p.x - WORLD_VIEW.w / 2, 0, Math.max(0, L.width - WORLD_VIEW.w));
  const ty = clamp(p.y - WORLD_VIEW.h * 0.62, 0, Math.max(0, L.height - WORLD_VIEW.h));
  if (snap) { state.cam.x = tx; state.cam.y = ty; }
  return { tx, ty };
}

/* ------------------------------------------------------------------ damage */

function hurt(amount, fromX) {
  const p = state.player;
  if (p.invuln > 0 || state.mode !== 'play') return;
  p.hp -= amount;
  p.invuln = INVULN_TIME;
  state.shake = 8;
  Sound.hurt();
  spawnParticles(p.x, p.y - PLAYER_H / 2, 12, {
    color: ['#ffffff', '#ffd6e5', '#ff9ec2'], speed: 200, life: 0.7, size: 3.5, shape: 'petal',
  });
  if (fromX !== undefined) {
    const dir = p.x < fromX ? -1 : 1;
    p.vx = dir * 260;
    p.vy = -300;
    p.grounded = false;
  }
  if (p.hp <= 0) {
    p.hp = 0;
    Sound.fail();
    setMode('dead');
  }
}

/* A fall out of the world: costs a flower and sends her back to the last
 * checkpoint, rather than knocking her around in mid-air. */
function fallOut() {
  const p = state.player;
  p.hp -= 1;
  Sound.hurt();
  state.shake = 7;
  if (p.hp <= 0) {
    p.hp = 0;
    Sound.fail();
    setMode('dead');
    return;
  }
  p.x = p.respawn.x;
  p.y = p.respawn.y;
  p.vx = 0;
  p.vy = 0;
  p.invuln = INVULN_TIME;
  p.fadeIn = 0.45;
  centerCamera(true);
}

/* ------------------------------------------------------------------ physics */

function moveAxis(p, dx, dy, solids) {
  if (dx !== 0) {
    p.x += dx;
    const r = playerRect(p);
    for (const s of solids) {
      if (!overlaps(r, s)) continue;
      if (dx > 0) p.x = s.x - PLAYER_W / 2;
      else p.x = s.x + s.w + PLAYER_W / 2;
      p.vx = 0;
      r.x = p.x - PLAYER_W / 2;
    }
  }
  if (dy !== 0) {
    p.y += dy;
    const r = playerRect(p);
    for (const s of solids) {
      if (!overlaps(r, s)) continue;
      if (dy > 0) {
        p.y = s.y;
        if (!p.grounded && p.vy > HARD_LAND_V) {
          hurt(1);
          spawnParticles(p.x, p.y, 16, { color: ['#c9b18f', '#e8d7bd'], speed: 220, angle: -Math.PI / 2, spread: 2.4, life: 0.5, size: 3 });
        } else if (p.vy > 400) {
          Sound.land();
          spawnParticles(p.x, p.y, 6, { color: ['#ffffff', '#e8e8e8'], speed: 110, angle: -Math.PI / 2, spread: 2.2, life: 0.32, size: 2.5 });
        }
        p.grounded = true;
        p.coyote = COYOTE_TIME;
      } else {
        p.y = s.y + s.h + PLAYER_H;
      }
      p.vy = 0;
      r.y = p.y - PLAYER_H;
    }
  }
}

function updatePlay(dt) {
  const p = state.player;
  const L = state.level;

  const wantLeft = Input.left;
  const wantRight = Input.right;
  const dir = (wantRight ? 1 : 0) - (wantLeft ? 1 : 0);

  const accel = p.grounded ? GROUND_ACCEL : AIR_ACCEL;
  if (dir !== 0) {
    p.vx += dir * accel * dt;
    p.vx = clamp(p.vx, -RUN_SPEED, RUN_SPEED);
    p.facing = dir;
  } else if (p.grounded) {
    const drop = GROUND_FRICTION * dt;
    p.vx = Math.abs(p.vx) <= drop ? 0 : p.vx - Math.sign(p.vx) * drop;
  }

  // jump: coyote time + input buffering make the controls forgiving
  if (Input.takeJump()) p.buffer = JUMP_BUFFER;
  p.buffer = Math.max(0, p.buffer - dt);
  p.coyote = p.grounded ? COYOTE_TIME : Math.max(0, p.coyote - dt);
  if (p.buffer > 0 && p.coyote > 0) {
    p.vy = -JUMP_V;
    p.grounded = false;
    p.buffer = 0;
    p.coyote = 0;
    Sound.jump();
    spawnParticles(p.x, p.y, 5, { color: ['#ffffff'], speed: 90, angle: Math.PI / 2, spread: 1.8, life: 0.28, size: 2.5 });
  }
  if (!Input.jumpHeld && p.vy < 0) p.vy *= Math.pow(JUMP_CUT, dt * 60);

  p.vy = Math.min(MAX_FALL, p.vy + GRAVITY * dt);

  const wasGrounded = p.grounded;
  p.grounded = false;
  moveAxis(p, p.vx * dt, 0, L.solids);
  moveAxis(p, 0, p.vy * dt, L.solids);
  if (wasGrounded && !p.grounded && p.vy >= 0) p.coyote = Math.max(p.coyote, COYOTE_TIME);

  p.x = clamp(p.x, PLAYER_W / 2, L.width - PLAYER_W / 2);
  if (p.grounded && Math.abs(p.vx) > 20) p.runPhase += dt * (6 + Math.abs(p.vx) / 34);
  p.idleTime = p.grounded && dir === 0 && Math.abs(p.vx) < 20 ? p.idleTime + dt : 0;
  p.invuln = Math.max(0, p.invuln - dt);
  p.fadeIn = Math.max(0, p.fadeIn - dt);

  // fell out of the world
  if (p.y > L.deathY) { fallOut(); return; }

  const r = playerRect(p);

  for (const s of L.spikes) {
    if (overlaps(r, s)) { hurt(1, s.x + s.w / 2); break; }
  }

  for (const c of L.coins) {
    if (c.taken) continue;
    if (overlaps(r, { x: c.x - 14, y: c.y - 14, w: 28, h: 28 })) {
      c.taken = true;
      state.coinsThisLevel++;
      state.coinsTotal++;
      Sound.coin();
      spawnParticles(c.x, c.y, 10, { color: ['#ffd84d', '#ffef9e', '#ffffff'], speed: 170, life: 0.55, size: 3, gravity: 300 });
    }
  }

  for (const c of L.checkpoints) {
    if (c.active) continue;
    if (overlaps(r, { x: c.x - 20, y: c.y - 70, w: 40, h: 70 })) {
      c.active = true;
      p.respawn = { x: c.x, y: c.y };
      Sound.checkpoint();
      spawnParticles(c.x, c.y - 55, 14, { color: ['#ffffff', '#ff5f8d', '#ffd84d'], speed: 170, life: 0.8, size: 3, gravity: 220 });
    }
  }

  if (L.cake && overlaps(r, { x: L.cake.x - 26, y: L.cake.y - 70, w: 52, h: 70 })) {
    const last = state.levelIndex === LEVELS.length - 1;
    if (last) {
      Sound.birthday();
      setMode('win');
    } else {
      Sound.levelClear();
      state.unlocked = Math.max(state.unlocked, state.levelIndex + 2);
      saveProgress();
      setMode('clear');
    }
    for (let i = 0; i < 60; i++) {
      spawnParticles(L.cake.x + (Math.random() - 0.5) * 120, L.cake.y - 80 - Math.random() * 60, 1, {
        color: ['#ff6b9d', '#ffd84d', '#6ad1c8', '#b48cff', '#ffffff'],
        speed: 180, life: 2.2, size: 5, gravity: 260, shape: 'confetti',
      });
    }
  }
}

function updateParticles(dt) {
  for (let i = state.particles.length - 1; i >= 0; i--) {
    const q = state.particles[i];
    q.life -= dt;
    if (q.life <= 0) { state.particles.splice(i, 1); continue; }
    q.vy += q.gravity * dt;
    q.x += q.vx * dt;
    q.y += q.vy * dt;
    q.rot += q.spin * dt;
  }
}

/* ------------------------------------------------------------------ drawing */

function drawParticles() {
  for (const q of state.particles) {
    const a = clamp(q.life / q.maxLife, 0, 1);
    if (a < 0.15 && Math.floor(state.time * 20) % 2) continue;   // blink out
    const x = Math.round(q.x * ART);
    const y = Math.round(q.y * ART);
    bctx.fillStyle = q.color;
    if (q.shape === 'confetti') bctx.fillRect(x, y, 4, 2);
    else bctx.fillRect(x, y, a > 0.5 ? 3 : 2, a > 0.5 ? 3 : 2);
  }
}

/* Text goes onto the full-size canvas rather than the pixel buffer, so it
 * stays readable; everything else is pixels. */
function txt(str, x, y, size, color, align = 'center', shadow = false) {
  ctx.font = `${size}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  if (shadow) {
    ctx.fillStyle = 'rgba(20,12,30,0.85)';
    ctx.fillText(str, x + size * 0.16, y + size * 0.16);
  }
  ctx.fillStyle = color;
  ctx.fillText(str, x, y);
}

function textWidthArt(str, size) {
  ctx.font = `${size}px ${FONT}`;
  return Math.ceil(ctx.measureText(str).width / A2T);
}

/* The reference HUD has no panels: the flowers sit straight on the sky, so the
 * text carries its own drop shadow to stay readable over anything. */
function drawHUDIcons() {
  const p = state.player;
  for (let i = 0; i < MAX_HP; i++) drawFlowerIcon(bctx, 8 + i * 19, 8, i < p.hp);
  drawCoinIcon(bctx, 9, 33);
}

function drawHUDText() {
  txt(`${state.coinsThisLevel}/${state.level.coins.length}`, 30 * A2T, 42 * A2T, 10, '#fff', 'left', true);
  txt(`L${state.levelIndex + 1}  ${state.level.name.toUpperCase()}`,
      (BUF.w - 10) * A2T, 16 * A2T, 10, '#ffd84d', 'right', true);
}

/* ------------------------------------------------------------- title screen */

function titleScene() {
  // Sunset sky over green ground, as in the design reference.
  if (!state.titleLevel) state.titleLevel = buildLevel({ ...LEVELS[0], skyImage: 'sky-dusk', sky: LEVELS[2].sky, title: true });
  drawBackground(bctx, state.titleLevel, { x: 400, y: 240 }, BUF, state.time);

  // a strip of ground for her to stand on
  const art = levelArt(state.titleLevel);
  for (let tx = 0; tx < BUF.w / ATILE + 1; tx++) {
    bctx.drawImage(art.top[tx % art.top.length], tx * ATILE, 196);
  }
  bctx.drawImage(art.tree, 30, 196 - art.tree.height + 6);
  bctx.drawImage(art.bush, 118, 196 - art.bush.height + 5);

  drawNandini(bctx, 214, 200, 1, {
    runPhase: 0, grounded: true, rising: false, hurtFlash: false,
    speed: 0, idleTime: state.time, time: state.time, victory: false,
  });
  drawCake(bctx, 430, 200, state.time);
  for (let i = 0; i < MAX_HP; i++) drawFlowerIcon(bctx, 8 + i * 19, 8, true);

  pixelPanel(bctx, 26, 240, BUF.w - 52, 112, 'rgba(22,16,42,0.92)', '#8f7ad4');

  // legend row: what each thing in the game is
  const y = 296;
  drawNandini(bctx, 92, y + 24, 1, {
    runPhase: 0, grounded: true, rising: false, hurtFlash: false,
    speed: 0, idleTime: 0, time: state.time, victory: false,
  });
  drawNandini(bctx, 196, y + 24, 1, {
    runPhase: 0, grounded: false, rising: true, hurtFlash: false,
    speed: 200, time: state.time, victory: false,
  });
  const coin = COIN_FRAMES[Math.floor(state.time * 7) % COIN_FRAMES.length];
  bctx.drawImage(coin, 300 - coin.width / 2, y + 4);
  drawSpikes(bctx, { tx: 364, ty: y - 16, dir: 'up' });
  drawSpikes(bctx, { tx: 404, ty: y - 16, dir: 'up' });
  bctx.drawImage(SPR_CAKE, 0, 0, SPR_CAKE.width, SPR_CAKE.height,
                 500 - 17, y - 10, Math.round(SPR_CAKE.width * 0.7), Math.round(SPR_CAKE.height * 0.7));
}

function titleText() {
  txt("NANDINI'S", VIEW.w / 2, 74, 26, '#fff', 'center', true);
  txt('BIRTHDAY RUN', VIEW.w / 2, 110, 26, '#ffd84d', 'center', true);
  txt('5 FLOWERS   3 LEVELS   1 CAKE', VIEW.w / 2, 142, 9, '#ffd8ea', 'center', true);
  if (Math.floor(state.time * 2) % 2) txt('PRESS ENTER TO START', VIEW.w / 2, 336, 12, '#ffd84d', 'center', true);
  if (state.unlocked > 1) txt(`1-${state.unlocked} PICKS A LEVEL`, VIEW.w / 2, 356, 8, '#ffe9b0', 'center', true);

  txt('REACH THE BIRTHDAY CAKE!', VIEW.w / 2, 396, 17, '#fff');
  const labels = ['MOVE', 'JUMP', 'COLLECT', 'AVOID SPIKES', 'REACH GOAL'];
  const xs = [138, 294, 450, 606, 750];
  labels.forEach((l, i) => txt(l, xs[i], 508, 9, '#d9cbf5'));
}

/* ----------------------------------------------------------------- overlays */

function overlayPanels() {
  const m = state.mode;
  if (m === 'intro' && state.modeTime < 2.1) pixelPanel(bctx, 80, 112, BUF.w - 160, 92);
  else if (m === 'dead') {
    px(bctx, 0, 0, BUF.w, BUF.h, 'rgba(20,10,24,0.62)');
    pixelPanel(bctx, 68, 116, BUF.w - 136, 104);
  } else if (m === 'clear') {
    px(bctx, 0, 0, BUF.w, BUF.h, 'rgba(20,10,24,0.5)');
    pixelPanel(bctx, 68, 104, BUF.w - 136, 124);
  } else if (m === 'win' && state.modeTime > 0.6) {
    px(bctx, 0, 0, BUF.w, BUF.h, 'rgba(20,10,24,0.6)');
    pixelPanel(bctx, 48, 76, BUF.w - 96, 192);
  }
}

function overlayText() {
  const L = state.level;
  const m = state.mode;
  const blink = Math.floor(state.time * 2) % 2;
  if (m === 'intro' && state.modeTime < 2.1) {
    txt(`LEVEL ${state.levelIndex + 1}`, VIEW.w / 2, 200, 10, '#ffd84d');
    txt(L.name.toUpperCase(), VIEW.w / 2, 232, 16, '#fff');
    txt(L.hint.toUpperCase(), VIEW.w / 2, 268, 8, '#c9b6d8');
  } else if (m === 'dead') {
    txt('OUT OF FLOWERS', VIEW.w / 2, 204, 20, '#ff9ec2');
    txt('THE CAKE IS STILL WAITING', VIEW.w / 2, 244, 9, '#c9b6d8');
    if (blink) txt('PRESS ENTER TO RETRY', VIEW.w / 2, 288, 11, '#ffd84d');
  } else if (m === 'clear') {
    txt('LEVEL COMPLETE', VIEW.w / 2, 190, 19, '#ffd84d');
    txt(`COINS ${state.coinsThisLevel}/${L.coins.length}`, VIEW.w / 2, 228, 11, '#fff');
    txt(`FLOWERS ${state.player.hp}/${MAX_HP}`, VIEW.w / 2, 254, 11, '#fff');
    if (blink) txt('PRESS ENTER', VIEW.w / 2, 296, 11, '#ffd84d');
  } else if (m === 'win' && state.modeTime > 0.6) {
    txt('HAPPY BIRTHDAY', VIEW.w / 2, 158, 24, '#fff');
    txt('NANDINI!', VIEW.w / 2, 204, 34, '#ffd84d');
    txt('SHE MADE IT TO THE CAKE', VIEW.w / 2, 250, 10, '#ffb8d2');
    txt(`COINS ${state.coinsTotal}   FLOWERS ${state.player.hp}/${MAX_HP}`, VIEW.w / 2, 286, 10, '#fff');
    if (blink) txt('PRESS ENTER TO PLAY AGAIN', VIEW.w / 2, 330, 10, '#ffd84d');
  }
}

/* ------------------------------------------------------------------- render */

/* Size the canvas to a whole-number multiple of the art resolution. Anything
 * else would resample the pixels unevenly and make some of them fatter than
 * others. */
/* True when the stylesheet has turned the stage sideways, which swaps the space
 * the game has to fit into. Must match the matching rule in css/style.css. */
const PORTRAIT_PHONE = window.matchMedia(
  '(hover: none) and (pointer: coarse) and (orientation: portrait) and (max-width: 700px)');

function layout() {
  const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
  const foot = document.getElementById('footnote');
  const footH = foot && getComputedStyle(foot).display !== 'none' ? foot.offsetHeight + 12 : 4;
  const turned = PORTRAIT_PHONE.matches;
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  const availW = (turned ? vh : vw) - 8;
  const availH = (turned ? vw : vh) - footH - 8;
  // Whole-number zoom keeps every art pixel the same size. Only when the
  // window is smaller than the art itself do we fall back to a fractional
  // scale, because the alternative is not fitting on screen at all.
  const fit = Math.min(availW / BUF.w, availH / BUF.h);
  const s = fit >= 1 ? Math.floor(fit) : Math.max(0.35, fit);
  if (s === SCALE && dpr === DPR && turned === TURNED) return;
  TURNED = turned;
  SCALE = s;
  DPR = dpr;
  const store = Math.max(1, Math.round(s));   // backing store stays whole
  canvas.style.width = Math.round(BUF.w * s) + 'px';
  canvas.style.height = Math.round(BUF.h * s) + 'px';
  canvas.width = BUF.w * store * dpr;
  canvas.height = BUF.h * store * dpr;
  STORE = store;
}

/* Switch the canvas into the 960x540 space the text is written against. */
function textSpace() {
  const k = (DPR * STORE * BUF.w) / VIEW.w;
  ctx.setTransform(k, 0, 0, k, 0, 0);
}

function blitBuffer() {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(buffer, 0, 0, BUF.w, BUF.h, 0, 0, BUF.w * STORE, BUF.h * STORE);
}

function render() {
  layout();

  if (state.mode === 'title') {
    titleScene();
    blitBuffer();
    textSpace();
    titleText();
    return;
  }

  const L = state.level;
  const p = state.player;

  drawBackground(bctx, L, state.cam, BUF, state.time);

  const shake = state.shake > 0 ? Math.round((Math.random() - 0.5) * state.shake) : 0;
  const shakeY = state.shake > 0 ? Math.round((Math.random() - 0.5) * state.shake) : 0;

  bctx.save();
  bctx.translate(-Math.round(state.cam.x * ART) + shake, -Math.round(state.cam.y * ART) + shakeY);

  drawTerrain(bctx, L, state.cam, BUF);
  for (const s of L.spikes) drawSpikes(bctx, s);
  for (const c of L.checkpoints) drawCheckpoint(bctx, c, state.time);
  for (const c of L.coins) if (!c.taken) drawCoin(bctx, c, state.time);
  if (L.cake) drawCake(bctx, L.cake.x, L.cake.y, state.time);
  drawParticles();

  const blinking = p.invuln > 0 && Math.floor(state.time * 18) % 2 === 0;
  const fading = p.fadeIn > 0 && Math.floor(state.time * 24) % 2 === 0;
  if (!blinking && !fading) {
    drawNandini(bctx, p.x, p.y, p.facing, {
      runPhase: p.runPhase,
      grounded: p.grounded,
      rising: p.vy < 0,
      hurtFlash: p.invuln > 0,
      speed: Math.abs(p.vx),
      idleTime: p.idleTime,
      time: state.time,
      victory: state.mode === 'win' || state.mode === 'clear',
    });
  }
  bctx.restore();

  drawHUDIcons();
  overlayPanels();

  blitBuffer();
  textSpace();

  drawHUDText();
  overlayText();

  if (Sound.muted) txt('MUTED (M)', VIEW.w - 16, VIEW.h - 14, 8, 'rgba(255,255,255,0.6)', 'right');
}

/* --------------------------------------------------------------- game loop */

function handleMenuKeys() {
  if (Input.wasPressed('KeyM')) Sound.toggleMute();

  if (state.mode === 'title') {
    if (Input.wasPressed('Enter')) { Sound.unlock(); state.coinsTotal = 0; startLevel(0); }
    for (let i = 0; i < state.unlocked && i < LEVELS.length; i++) {
      if (Input.wasPressed(`Digit${i + 1}`)) { Sound.unlock(); state.coinsTotal = 0; startLevel(i); }
    }
  } else if (state.mode === 'dead') {
    if (Input.wasPressed('Enter') || Input.wasPressed('KeyR')) {
      state.coinsTotal -= state.coinsThisLevel;
      startLevel(state.levelIndex);
    }
  } else if (state.mode === 'clear') {
    if (Input.wasPressed('Enter') && state.modeTime > 0.4) startLevel(state.levelIndex + 1);
  } else if (state.mode === 'win') {
    if (Input.wasPressed('Enter') && state.modeTime > 1.2) setMode('title');
  } else if (state.mode === 'play' || state.mode === 'intro') {
    if (Input.wasPressed('KeyR')) { state.coinsTotal -= state.coinsThisLevel; startLevel(state.levelIndex); }
    if (Input.wasPressed('Escape')) setMode('title');
  }
}

let lastTime = performance.now();
let accumulator = 0;
const STEP = 1 / 120;

function frame(now) {
  // Clamp to >= 0: the first rAF timestamp can predate the performance.now()
  // captured at load, and a negative delta would run the physics backwards.
  const raw = clamp((now - lastTime) / 1000, 0, 0.1);
  lastTime = now;
  state.time += raw;
  state.modeTime += raw;

  handleMenuKeys();

  if (state.mode === 'intro' && state.modeTime > 0.35) setMode('play');

  if (state.level) {
    accumulator += raw;
    let guard = 0;
    while (accumulator >= STEP && guard++ < 8) {
      if (state.mode === 'play') updatePlay(STEP);
      accumulator -= STEP;
    }
    if (accumulator > STEP) accumulator = 0;

    updateParticles(raw);
    state.shake = Math.max(0, state.shake - raw * 28);

    const { tx, ty } = centerCamera(false);
    const k = 1 - Math.pow(0.0006, raw);
    state.cam.x += (tx - state.cam.x) * k;
    state.cam.y += (ty - state.cam.y) * k;
  }

  Input.endFrame();
  render();
  requestAnimationFrame(frame);
}

/* ------------------------------------------------------------------- start */

loadProgress();
layout();
window.addEventListener('resize', layout);
window.addEventListener('orientationchange', layout);
PORTRAIT_PHONE.addEventListener('change', layout);
Input.bindTouch(document.getElementById('btn-left'), 'left');
Input.bindTouch(document.getElementById('btn-right'), 'right');
Input.bindTouch(document.getElementById('btn-jump'), 'jump');
canvas.addEventListener('pointerdown', () => {
  Sound.unlock();
  if (state.mode === 'title') { state.coinsTotal = 0; startLevel(0); }
  else if (state.mode === 'dead') { state.coinsTotal -= state.coinsThisLevel; startLevel(state.levelIndex); }
  else if (state.mode === 'clear' && state.modeTime > 0.4) startLevel(state.levelIndex + 1);
  else if (state.mode === 'win' && state.modeTime > 1.2) setMode('title');
});
requestAnimationFrame(frame);
