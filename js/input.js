/* Keyboard + on-screen touch controls, collapsed into one small state object. */
const Input = (() => {
  const held = new Set();
  const pressed = new Set(); // consumed once per frame by the game loop
  const touch = { left: false, right: false, jump: false };
  let jumpQueued = false;

  const LEFT = ['ArrowLeft', 'KeyA'];
  const RIGHT = ['ArrowRight', 'KeyD'];
  const JUMP = ['Space', 'ArrowUp', 'KeyW', 'KeyZ'];

  window.addEventListener('keydown', (e) => {
    if ([...LEFT, ...RIGHT, ...JUMP, 'KeyR', 'KeyP', 'Enter', 'Escape'].includes(e.code)) e.preventDefault();
    if (e.repeat) return;
    held.add(e.code);
    pressed.add(e.code);
    if (JUMP.includes(e.code)) jumpQueued = true;
  });
  window.addEventListener('keyup', (e) => held.delete(e.code));
  window.addEventListener('blur', () => { held.clear(); touch.left = touch.right = touch.jump = false; });

  function bindTouch(el, key) {
    if (!el) return;
    const on = (e) => { e.preventDefault(); touch[key] = true; if (key === 'jump') jumpQueued = true; };
    const off = (e) => { e.preventDefault(); touch[key] = false; };
    el.addEventListener('touchstart', on, { passive: false });
    el.addEventListener('touchend', off, { passive: false });
    el.addEventListener('touchcancel', off, { passive: false });
    el.addEventListener('mousedown', on);
    el.addEventListener('mouseup', off);
    el.addEventListener('mouseleave', off);
  }

  return {
    bindTouch,
    get left() { return LEFT.some((k) => held.has(k)) || touch.left; },
    get right() { return RIGHT.some((k) => held.has(k)) || touch.right; },
    get jumpHeld() { return JUMP.some((k) => held.has(k)) || touch.jump; },
    /** True once for each fresh jump press; cleared when the game reads it. */
    takeJump() { const q = jumpQueued; jumpQueued = false; return q; },
    wasPressed(code) { return pressed.has(code); },
    endFrame() { pressed.clear(); },
    clear() { held.clear(); pressed.clear(); jumpQueued = false; touch.left = touch.right = touch.jump = false; },
  };
})();
