/* Nandini's Birthday Run — main loop, physics and game states. */

const VIEW = { w: 960, h: 540 };
// The world is drawn zoomed in, so Nandini fills a comfortable part of the
// screen. WORLD_VIEW is how much of the level fits on screen, in world pixels.
const ZOOM = 1.5;
const WORLD_VIEW = { w: VIEW.w / ZOOM, h: VIEW.h / ZOOM };

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
  giftsThisLevel: 0,
  giftsTotal: 0,
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
  state.giftsThisLevel = 0;
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
  p.invuln = Math.max(0, p.invuln - dt);
  p.fadeIn = Math.max(0, p.fadeIn - dt);

  // fell out of the world
  if (p.y > L.deathY) { fallOut(); return; }

  const r = playerRect(p);

  for (const s of L.spikes) {
    if (overlaps(r, s)) { hurt(1, s.x + s.w / 2); break; }
  }

  for (const g of L.gifts) {
    if (g.taken) continue;
    if (overlaps(r, { x: g.x - 13, y: g.y - 13, w: 26, h: 26 })) {
      g.taken = true;
      state.giftsThisLevel++;
      state.giftsTotal++;
      Sound.gift();
      spawnParticles(g.x, g.y, 10, { color: ['#ffd84d', '#6ad1c8', '#ff6b9d'], speed: 170, life: 0.55, size: 3, gravity: 300 });
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
    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(q.x, q.y);
    ctx.rotate(q.rot);
    ctx.fillStyle = q.color;
    if (q.shape === 'confetti') ctx.fillRect(-q.size / 2, -q.size / 4, q.size, q.size / 2);
    else if (q.shape === 'petal') { ctx.beginPath(); ctx.ellipse(0, 0, q.size, q.size * 0.6, 0, 0, Math.PI * 2); ctx.fill(); }
    else { ctx.beginPath(); ctx.arc(0, 0, q.size * a, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
  }
}

function drawHUD() {
  const p = state.player;
  const L = state.level;

  ctx.save();
  ctx.fillStyle = 'rgba(20,16,32,0.32)';
  roundRect(ctx, 14, 12, 214, 40, 20);
  ctx.fill();
  for (let i = 0; i < MAX_HP; i++) {
    drawFlower(ctx, 40 + i * 38, 32, 13, i < p.hp, state.time * 0.5 + i);
  }
  ctx.restore();

  ctx.save();
  ctx.fillStyle = 'rgba(20,16,32,0.32)';
  roundRect(ctx, VIEW.w - 214, 12, 200, 40, 20);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 17px Fredoka, "Trebuchet MS", sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText(`Level ${state.levelIndex + 1} · ${L.name}`, VIEW.w - 26, 33);
  ctx.restore();

  ctx.save();
  ctx.fillStyle = 'rgba(20,16,32,0.32)';
  roundRect(ctx, 14, 60, 118, 32, 16);
  ctx.fill();
  drawGift(ctx, { x: 34, y: 76, seed: 0 }, 0);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 16px Fredoka, "Trebuchet MS", sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${state.giftsThisLevel} / ${L.gifts.length}`, 52, 77);
  ctx.restore();
}

function panel(x, y, w, h) {
  ctx.fillStyle = 'rgba(24,18,38,0.82)';
  roundRect(ctx, x, y, w, h, 22);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = 2;
  ctx.stroke();
}

function centeredText(text, y, size, color = '#fff', weight = 'bold') {
  ctx.fillStyle = color;
  ctx.font = `${weight} ${size}px Fredoka, "Trebuchet MS", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, VIEW.w / 2, y);
}

function drawTitle() {
  const g = ctx.createLinearGradient(0, 0, 0, VIEW.h);
  g.addColorStop(0, '#ff9ec2');
  g.addColorStop(1, '#ffe6f0');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, VIEW.w, VIEW.h);

  for (let i = 0; i < 9; i++) {
    const bx = 90 + i * 96;
    const by = 120 + Math.sin(state.time * 1.1 + i) * 26 + (i % 3) * 40;
    drawCheckpoint(ctx, { x: bx, y: by + 90, active: true }, state.time + i);
  }

  centeredText("Nandini's Birthday Run", 146, 52, '#4a1f3a');
  centeredText('Five flowers. Three levels. One cake.', 192, 21, '#7a3a5e', '600');

  ctx.save();
  ctx.translate(VIEW.w / 2, 348);
  ctx.scale(2.1, 2.1);
  drawNandini(ctx, -58, 0, 1, {
    runPhase: state.time * 6, grounded: true, vy: 0, hurtFlash: false, speed: 40, time: state.time, victory: false,
  });
  drawCake(ctx, 58, 0, state.time);
  ctx.restore();
  for (let i = 0; i < MAX_HP; i++) drawFlower(ctx, VIEW.w / 2 - 76 + i * 38, 378, 13, true, state.time * 0.4 + i);

  panel(VIEW.w / 2 - 260, 400, 520, 108);
  centeredText('← → or A D to move · Space to jump', 428, 19);
  centeredText('Spikes and long falls cost a flower. Lose all five and you start the level over.', 456, 15, 'rgba(255,255,255,0.82)', '500');
  const pulse = 0.65 + Math.sin(state.time * 4) * 0.35;
  ctx.globalAlpha = pulse;
  centeredText('Press ENTER to start', 487, 21, '#ffd84d');
  ctx.globalAlpha = 1;

  if (state.unlocked > 1) {
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(74,31,58,0.75)';
    ctx.font = '500 15px Fredoka, "Trebuchet MS", sans-serif';
    ctx.fillText(`Press 1–${state.unlocked} to jump straight to a level`, VIEW.w / 2, 526);
  }
}

function drawOverlays() {
  const L = state.level;
  if (state.mode === 'intro') {
    const t = state.modeTime;
    const a = t < 1.6 ? 1 : clamp(1 - (t - 1.6) / 0.5, 0, 1);
    ctx.globalAlpha = a;
    panel(VIEW.w / 2 - 300, 170, 600, 200);
    centeredText(`Level ${state.levelIndex + 1}`, 222, 22, '#ffd84d');
    centeredText(L.name, 268, 40);
    centeredText(L.hint, 320, 17, 'rgba(255,255,255,0.85)', '500');
    ctx.globalAlpha = 1;
  } else if (state.mode === 'dead') {
    ctx.fillStyle = 'rgba(20,10,24,0.6)';
    ctx.fillRect(0, 0, VIEW.w, VIEW.h);
    panel(VIEW.w / 2 - 280, 180, 560, 190);
    centeredText('Out of flowers!', 232, 38, '#ff9ec2');
    centeredText('The cake is still waiting.', 278, 19, 'rgba(255,255,255,0.85)', '500');
    ctx.globalAlpha = 0.65 + Math.sin(state.time * 4) * 0.35;
    centeredText('Press ENTER to try this level again', 330, 21, '#ffd84d');
    ctx.globalAlpha = 1;
  } else if (state.mode === 'clear') {
    ctx.fillStyle = 'rgba(20,10,24,0.45)';
    ctx.fillRect(0, 0, VIEW.w, VIEW.h);
    panel(VIEW.w / 2 - 280, 170, 560, 210);
    centeredText('Level complete!', 222, 36, '#ffd84d');
    centeredText(`Gifts found: ${state.giftsThisLevel} / ${L.gifts.length}`, 272, 20, '#fff', '600');
    centeredText(`Flowers left: ${state.player.hp} / ${MAX_HP}`, 302, 20, '#fff', '600');
    ctx.globalAlpha = 0.65 + Math.sin(state.time * 4) * 0.35;
    centeredText('Press ENTER for the next level', 348, 20, '#ffd84d');
    ctx.globalAlpha = 1;
  } else if (state.mode === 'win') {
    ctx.fillStyle = `rgba(20,10,24,${clamp(state.modeTime / 1.2, 0, 0.55)})`;
    ctx.fillRect(0, 0, VIEW.w, VIEW.h);
    if (state.modeTime > 0.6) {
      panel(VIEW.w / 2 - 320, 130, 640, 290);
      const wob = Math.sin(state.time * 3) * 2;
      ctx.save();
      ctx.translate(VIEW.w / 2, 0);
      ctx.rotate(wob * 0.004);
      ctx.translate(-VIEW.w / 2, 0);
      centeredText('Happy Birthday,', 190, 34, '#fff');
      centeredText('Nandini!', 244, 58, '#ffd84d');
      ctx.restore();
      centeredText('She made it to the cake. 🎂', 292, 20, 'rgba(255,255,255,0.9)', '500');
      centeredText(`Gifts collected: ${state.giftsTotal}   ·   Flowers left: ${state.player.hp} / ${MAX_HP}`, 326, 18, '#fff', '600');
      ctx.globalAlpha = 0.65 + Math.sin(state.time * 4) * 0.35;
      centeredText('Press ENTER to play again', 384, 20, '#ffd84d');
      ctx.globalAlpha = 1;
    }
  }
}

function render() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (canvas.width !== VIEW.w * dpr || canvas.height !== VIEW.h * dpr) {
    canvas.width = VIEW.w * dpr;
    canvas.height = VIEW.h * dpr;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, VIEW.w, VIEW.h);

  if (state.mode === 'title') { drawTitle(); return; }

  const L = state.level;
  const p = state.player;
  const sx = state.shake > 0 ? (Math.random() - 0.5) * state.shake : 0;
  const sy = state.shake > 0 ? (Math.random() - 0.5) * state.shake : 0;

  ctx.save();
  ctx.scale(ZOOM, ZOOM);
  drawBackground(ctx, L, state.cam, WORLD_VIEW, state.time);
  ctx.translate(-Math.round(state.cam.x) + sx, -Math.round(state.cam.y) + sy);

  drawTerrain(ctx, L);
  for (const s of L.spikes) drawSpikes(ctx, s);
  for (const c of L.checkpoints) drawCheckpoint(ctx, c, state.time);
  for (const g of L.gifts) if (!g.taken) drawGift(ctx, g, state.time);
  if (L.cake) drawCake(ctx, L.cake.x, L.cake.y, state.time);
  drawParticles();

  const blinking = p.invuln > 0 && Math.floor(state.time * 18) % 2 === 0;
  if (!blinking) {
    ctx.globalAlpha = p.fadeIn > 0 ? 1 - p.fadeIn / 0.45 : 1;
    drawNandini(ctx, p.x, p.y, p.facing, {
      runPhase: p.runPhase,
      grounded: p.grounded,
      hurtFlash: p.invuln > 0,
      speed: Math.abs(p.vx),
      time: state.time,
      victory: state.mode === 'win' || state.mode === 'clear',
    });
    ctx.globalAlpha = 1;
  }
  ctx.restore();

  drawHUD();
  drawOverlays();

  if (Sound.muted) {
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = '500 13px Fredoka, "Trebuchet MS", sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText('muted (M)', VIEW.w - 16, VIEW.h - 12);
  }
}

/* --------------------------------------------------------------- game loop */

function handleMenuKeys() {
  if (Input.wasPressed('KeyM')) Sound.toggleMute();

  if (state.mode === 'title') {
    if (Input.wasPressed('Enter')) { Sound.unlock(); state.giftsTotal = 0; startLevel(0); }
    for (let i = 0; i < state.unlocked && i < LEVELS.length; i++) {
      if (Input.wasPressed(`Digit${i + 1}`)) { Sound.unlock(); state.giftsTotal = 0; startLevel(i); }
    }
  } else if (state.mode === 'dead') {
    if (Input.wasPressed('Enter') || Input.wasPressed('KeyR')) {
      state.giftsTotal -= state.giftsThisLevel;
      startLevel(state.levelIndex);
    }
  } else if (state.mode === 'clear') {
    if (Input.wasPressed('Enter') && state.modeTime > 0.4) startLevel(state.levelIndex + 1);
  } else if (state.mode === 'win') {
    if (Input.wasPressed('Enter') && state.modeTime > 1.2) setMode('title');
  } else if (state.mode === 'play' || state.mode === 'intro') {
    if (Input.wasPressed('KeyR')) { state.giftsTotal -= state.giftsThisLevel; startLevel(state.levelIndex); }
    if (Input.wasPressed('Escape')) setMode('title');
  }
}

let lastTime = performance.now();
let accumulator = 0;
const STEP = 1 / 120;

function frame(now) {
  const raw = Math.min(0.1, (now - lastTime) / 1000);
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
Input.bindTouch(document.getElementById('btn-left'), 'left');
Input.bindTouch(document.getElementById('btn-right'), 'right');
Input.bindTouch(document.getElementById('btn-jump'), 'jump');
canvas.addEventListener('pointerdown', () => {
  Sound.unlock();
  if (state.mode === 'title') { state.giftsTotal = 0; startLevel(0); }
  else if (state.mode === 'dead') { state.giftsTotal -= state.giftsThisLevel; startLevel(state.levelIndex); }
  else if (state.mode === 'clear' && state.modeTime > 0.4) startLevel(state.levelIndex + 1);
  else if (state.mode === 'win' && state.modeTime > 1.2) setMode('title');
});
requestAnimationFrame(frame);
