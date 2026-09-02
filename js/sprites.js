/* All artwork is drawn with canvas primitives — no image files to lose. */

const PALETTE = {
  skin: '#e0a97c',
  skinShade: '#c88d62',
  hair: '#2b1a16',
  hairShine: '#4a2f27',
  dress: '#e4568f',
  dressDark: '#c53c74',
  trim: '#ffd84d',
  legs: '#e0a97c',
  shoe: '#4d2e22',
  flower: '#ffffff',
  flowerCore: '#ffcf3d',
  cakeBase: '#f6d9b0',
  cakeIcing: '#ff8fb1',
  cakeCream: '#fff3e0',
  spike: '#5c6272',
  spikeLight: '#9aa2b1',
};

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* A five-petal flower — the same shape is the health icon and the bloom in
 * Nandini's hair, so the HUD reads as "her flowers". */
function drawFlower(ctx, x, y, r, filled, tilt = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(tilt);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
    ctx.beginPath();
    ctx.ellipse(Math.cos(a) * r * 0.62, Math.sin(a) * r * 0.62, r * 0.5, r * 0.38, a, 0, Math.PI * 2);
    if (filled) {
      ctx.fillStyle = PALETTE.flower;
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.18)';
      ctx.lineWidth = 1;
      ctx.stroke();
    } else {
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.32, 0, Math.PI * 2);
  ctx.fillStyle = filled ? PALETTE.flowerCore : 'rgba(255,255,255,0.25)';
  ctx.fill();
  ctx.restore();
}

/* Nandini. (cx, feetY) is the bottom-centre of her 28x40 hitbox. */
function drawNandini(ctx, cx, feetY, facing, anim) {
  const { runPhase, grounded, hurtFlash, victory } = anim;
  ctx.save();
  ctx.translate(cx, feetY);
  ctx.scale(facing < 0 ? -1 : 1, 1);

  const moving = anim.speed > 20;
  const bob = grounded ? (moving ? Math.sin(runPhase * 2) * 1.1 : Math.sin(anim.time * 3) * 0.7) : 0;
  ctx.translate(0, bob);

  const swing = grounded && moving ? Math.sin(runPhase) : 0;
  const airborne = !grounded;
  if (hurtFlash) ctx.globalAlpha = 0.9;

  // --- legs (drawn first so the dress hem overlaps them) ---
  ctx.strokeStyle = PALETTE.legs;
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  const legs = airborne
    ? [{ x: -3.5, dx: 3.5, dy: -4 }, { x: 3.5, dx: -2.5, dy: 0 }]
    : [{ x: -3.5, dx: swing * 5.5, dy: -Math.max(0, swing) * 2 },
       { x: 3.5, dx: -swing * 5.5, dy: -Math.max(0, -swing) * 2 }];
  for (const l of legs) {
    ctx.beginPath();
    ctx.moveTo(l.x, -14);
    ctx.lineTo(l.x + l.dx, -2 + l.dy);
    ctx.stroke();
    ctx.fillStyle = PALETTE.shoe;
    roundRect(ctx, l.x + l.dx - 4, -2 + l.dy - 1.5, 8, 4, 1.8);
    ctx.fill();
  }

  // --- long hair falling behind the shoulders ---
  ctx.fillStyle = PALETTE.hair;
  ctx.beginPath();
  ctx.moveTo(-8, -33);
  ctx.quadraticCurveTo(-10.5, -24, -8.5, -13);
  ctx.quadraticCurveTo(0, -10.5, 8.5, -13);
  ctx.quadraticCurveTo(10.5, -24, 8, -33);
  ctx.closePath();
  ctx.fill();

  // --- arms ---
  ctx.strokeStyle = PALETTE.skin;
  ctx.lineWidth = 3.4;
  const armSwing = airborne ? -1 : swing * 0.9;
  ctx.beginPath();
  ctx.moveTo(-5.5, -23);
  if (victory) ctx.lineTo(-9.5, -37);
  else ctx.lineTo(-10 - armSwing * 3, -14 + armSwing * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(5.5, -23);
  if (victory) ctx.lineTo(9.5, -37);
  else ctx.lineTo(10 + armSwing * 3, -14 - armSwing * 2);
  ctx.stroke();

  // --- dress ---
  ctx.fillStyle = PALETTE.dress;
  ctx.beginPath();
  ctx.moveTo(-5.5, -24.5);
  ctx.lineTo(5.5, -24.5);
  ctx.quadraticCurveTo(8.5, -19, 9.5, -12.5);
  ctx.quadraticCurveTo(0, -10.5, -9.5, -12.5);
  ctx.quadraticCurveTo(-8.5, -19, -5.5, -24.5);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = PALETTE.trim;
  ctx.fillRect(-6.4, -19.5, 12.8, 1.6);
  ctx.fillStyle = PALETTE.dressDark;
  ctx.beginPath();
  ctx.moveTo(-9.5, -12.5);
  ctx.quadraticCurveTo(0, -10.5, 9.5, -12.5);
  ctx.quadraticCurveTo(0, -13.6, -9.5, -12.5);
  ctx.closePath();
  ctx.fill();

  // --- head ---
  ctx.fillStyle = PALETTE.skin;
  ctx.beginPath();
  ctx.arc(0, -31, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = PALETTE.skinShade;
  ctx.beginPath();
  ctx.ellipse(0, -23.4, 2.6, 1.6, 0, 0, Math.PI * 2);   // neck
  ctx.fill();

  // fringe, side strands, little bun
  ctx.fillStyle = PALETTE.hair;
  ctx.beginPath();
  ctx.arc(0, -31.4, 8.2, Math.PI * 1.02, Math.PI * 2.02);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-8.2, -32);
  ctx.quadraticCurveTo(-9.4, -28, -7.6, -25);
  ctx.lineTo(-5.6, -26.5);
  ctx.quadraticCurveTo(-6.6, -29, -6.2, -32);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.arc(-6.6, -37, 3.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = PALETTE.hairShine;
  ctx.beginPath();
  ctx.ellipse(1.5, -36.2, 3.4, 1.4, -0.35, 0, Math.PI * 2);
  ctx.fill();

  drawFlower(ctx, 7.2, -34.6, 3.2, true, anim.time * 0.6);

  // --- face ---
  ctx.fillStyle = '#2a1a18';
  ctx.beginPath();
  ctx.arc(2.9, -30.6, 1.25, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(-2.3, -30.6, 1.25, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.beginPath();
  ctx.arc(3.3, -31.1, 0.42, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(-1.9, -31.1, 0.42, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#8a4a3a';
  ctx.lineWidth = 1;
  ctx.beginPath();
  if (hurtFlash) ctx.arc(0.3, -25.6, 2, Math.PI * 1.15, Math.PI * 1.85);
  else ctx.arc(0.3, -28.6, 2.3, 0.2, Math.PI - 0.2);
  ctx.stroke();

  ctx.fillStyle = 'rgba(255,130,155,0.45)';
  ctx.beginPath();
  ctx.arc(5.6, -28.8, 1.7, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(-5, -28.8, 1.7, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawCake(ctx, x, baseY, t) {
  ctx.save();
  ctx.translate(x, baseY);
  const bob = Math.sin(t * 2) * 1.5;
  ctx.translate(0, bob);

  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.beginPath();
  ctx.ellipse(0, 1 - bob, 22, 5, 0, 0, Math.PI * 2);
  ctx.fill();

  // plate
  ctx.fillStyle = '#ffffff';
  roundRect(ctx, -24, -6, 48, 6, 3);
  ctx.fill();

  const tiers = [
    { w: 40, h: 16, y: -22 },
    { w: 30, h: 14, y: -36 },
    { w: 20, h: 12, y: -48 },
  ];
  tiers.forEach((tier, i) => {
    ctx.fillStyle = i % 2 ? PALETTE.cakeIcing : PALETTE.cakeBase;
    roundRect(ctx, -tier.w / 2, tier.y, tier.w, tier.h, 3);
    ctx.fill();
    ctx.fillStyle = PALETTE.cakeCream;
    ctx.beginPath();
    for (let d = 0; d + 6 <= tier.w; d += 6) {
      ctx.moveTo(-tier.w / 2 + d, tier.y + 3);
      ctx.arc(-tier.w / 2 + d + 3, tier.y + 3, 3.1, Math.PI, 0, true);
    }
    ctx.fill();
  });

  // candle
  ctx.fillStyle = '#7fd4ff';
  ctx.fillRect(-2.5, -62, 5, 14);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(-2.5, -58, 5, 3);
  const flick = Math.sin(t * 14) * 1.2;
  ctx.fillStyle = '#ffd24d';
  ctx.beginPath();
  ctx.ellipse(flick * 0.4, -67, 3.4, 6, flick * 0.06, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.beginPath();
  ctx.ellipse(flick * 0.3, -66, 1.5, 3, 0, 0, Math.PI * 2);
  ctx.fill();

  // glow
  const g = ctx.createRadialGradient(0, -66, 2, 0, -66, 46);
  g.addColorStop(0, 'rgba(255,214,120,0.35)');
  g.addColorStop(1, 'rgba(255,214,120,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, -66, 46, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawSpikes(ctx, s) {
  const n = 3;
  const w = TILE / n;
  ctx.save();
  for (let i = 0; i < n; i++) {
    const x0 = s.tx + i * w;
    ctx.beginPath();
    if (s.dir === 'up') {
      ctx.moveTo(x0 + 1, s.ty + TILE);
      ctx.lineTo(x0 + w / 2, s.ty + 6);
      ctx.lineTo(x0 + w - 1, s.ty + TILE);
    } else {
      ctx.moveTo(x0 + 1, s.ty);
      ctx.lineTo(x0 + w / 2, s.ty + TILE - 6);
      ctx.lineTo(x0 + w - 1, s.ty);
    }
    ctx.closePath();
    ctx.fillStyle = PALETTE.spike;
    ctx.fill();
    ctx.strokeStyle = PALETTE.spikeLight;
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }
  ctx.restore();
}

function drawGift(ctx, g, t) {
  ctx.save();
  ctx.translate(g.x, g.y + Math.sin(t * 3 + g.seed) * 3);
  ctx.rotate(Math.sin(t * 1.6 + g.seed) * 0.18);
  ctx.fillStyle = '#6ad1c8';
  roundRect(ctx, -9, -8, 18, 16, 2.5);
  ctx.fill();
  ctx.fillStyle = '#ffd84d';
  ctx.fillRect(-2, -8, 4, 16);
  ctx.fillRect(-9, -2, 18, 4);
  ctx.fillStyle = '#ffd84d';
  ctx.beginPath();
  ctx.ellipse(-4.5, -10.5, 4, 3, -0.35, 0, Math.PI * 2);
  ctx.ellipse(4.5, -10.5, 4, 3, 0.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffe98a';
  ctx.beginPath();
  ctx.arc(0, -9.5, 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawCheckpoint(ctx, c, t) {
  const sway = Math.sin(t * 1.7 + c.x * 0.01) * 4;
  const topY = c.y - 62 + Math.sin(t * 2 + c.x * 0.02) * 2;
  ctx.save();
  ctx.strokeStyle = c.active ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(c.x, c.y - 2);
  ctx.quadraticCurveTo(c.x + sway * 0.5, c.y - 30, c.x + sway, topY + 16);
  ctx.stroke();

  ctx.fillStyle = c.active ? '#ff5f8d' : 'rgba(200,200,210,0.55)';
  ctx.beginPath();
  ctx.ellipse(c.x + sway, topY, 12, 15, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(c.x + sway - 3, topY + 14);
  ctx.lineTo(c.x + sway + 3, topY + 14);
  ctx.lineTo(c.x + sway, topY + 18);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.beginPath();
  ctx.ellipse(c.x + sway - 4, topY - 5, 3, 4.5, -0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/* Parallax scenery. Everything is a deterministic function of x so it never
 * shimmers as the camera moves. */
function drawBackground(ctx, level, cam, view, t) {
  const g = ctx.createLinearGradient(0, 0, 0, view.h);
  g.addColorStop(0, level.sky[0]);
  g.addColorStop(1, level.sky[1]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, view.w, view.h);

  // clouds
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  for (let i = 0; i < 14; i++) {
    const bx = ((i * 337) % (level.width + 600)) - cam.x * 0.25;
    const by = 40 + ((i * 197) % 180) - cam.y * 0.12;
    const s = 18 + ((i * 53) % 22);
    if (bx < -160 || bx > view.w + 160) continue;
    ctx.beginPath();
    ctx.arc(bx, by, s, 0, Math.PI * 2);
    ctx.arc(bx + s * 0.8, by + 4, s * 0.7, 0, Math.PI * 2);
    ctx.arc(bx - s * 0.8, by + 5, s * 0.6, 0, Math.PI * 2);
    ctx.fill();
  }

  // Far hills, hazed toward the sky so they never compete with the terrain the
  // player actually stands on.
  const horizon = view.h - 90 - cam.y * 0.08;
  ctx.globalAlpha = 0.42;
  ctx.fillStyle = level.hillBack;
  ctx.beginPath();
  ctx.moveTo(0, view.h);
  for (let x = 0; x <= view.w; x += 20) {
    const wx = x + cam.x * 0.35;
    ctx.lineTo(x, horizon - 40 - Math.sin(wx * 0.004) * 34 - Math.sin(wx * 0.011) * 12);
  }
  ctx.lineTo(view.w, view.h);
  ctx.closePath();
  ctx.fill();

  ctx.globalAlpha = 0.5;
  ctx.fillStyle = level.hill;
  ctx.beginPath();
  ctx.moveTo(0, view.h);
  for (let x = 0; x <= view.w; x += 20) {
    const wx = x + cam.x * 0.55;
    ctx.lineTo(x, horizon - Math.sin(wx * 0.006 + 1.2) * 26 - Math.sin(wx * 0.015) * 9);
  }
  ctx.lineTo(view.w, view.h);
  ctx.closePath();
  ctx.fill();

  ctx.globalAlpha = 1;

  // Darken the lower half of the backdrop so gaps in the floor read as real
  // drops rather than as more hillside.
  const depth = ctx.createLinearGradient(0, horizon - 30, 0, view.h);
  depth.addColorStop(0, 'rgba(14,8,26,0)');
  depth.addColorStop(0.45, 'rgba(14,8,26,0.42)');
  depth.addColorStop(1, 'rgba(14,8,26,0.86)');
  ctx.fillStyle = depth;
  ctx.fillRect(0, horizon - 30, view.w, view.h - horizon + 30);

  // birthday bunting strung across the sky
  const buntY = 64 - cam.y * 0.16;
  ctx.strokeStyle = 'rgba(255,255,255,0.65)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let x = -60; x <= view.w + 60; x += 10) {
    const y = buntY + Math.abs(Math.sin((x + cam.x * 0.45) * 0.012)) * 14;
    x === -60 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.stroke();
  const flagColors = ['#ff6b9d', '#ffd84d', '#6ad1c8', '#b48cff'];
  for (let i = 0; i < 30; i++) {
    const fx = i * 60 - ((cam.x * 0.45) % 60);
    if (fx < -30 || fx > view.w + 30) continue;
    const fy = buntY + Math.abs(Math.sin((fx + cam.x * 0.45) * 0.012)) * 14;
    ctx.fillStyle = flagColors[i % flagColors.length];
    ctx.beginPath();
    ctx.moveTo(fx - 7, fy);
    ctx.lineTo(fx + 7, fy);
    ctx.lineTo(fx, fy + 16);
    ctx.closePath();
    ctx.fill();
  }
}

function drawTerrain(ctx, level) {
  for (const s of level.solids) {
    ctx.fillStyle = level.ground;
    roundRect(ctx, s.x, s.y, s.w, s.h, 4);
    ctx.fill();
    ctx.fillStyle = level.grass;
    roundRect(ctx, s.x, s.y, s.w, Math.min(10, s.h), 4);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(s.x + 3, s.y + 2, s.w - 6, 2);
  }
}
