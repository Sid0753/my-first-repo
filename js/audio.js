/* Tiny WebAudio blips. Created lazily so nothing is built before the first
 * user gesture, which is what browsers require to start audio. */
const Sound = (() => {
  let ctx = null;
  let muted = false;

  function ac() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function tone(freq, dur, type = 'square', gain = 0.06, delay = 0) {
    if (muted) return;
    const a = ac();
    if (!a) return;
    const t0 = a.currentTime + delay;
    const osc = a.createOscillator();
    const g = a.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(a.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  function slide(f0, f1, dur, type = 'sawtooth', gain = 0.05) {
    if (muted) return;
    const a = ac();
    if (!a) return;
    const t0 = a.currentTime;
    const osc = a.createOscillator();
    const g = a.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t0 + dur);
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(a.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  const N = { C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.0, A4: 440.0, Bb4: 466.16, C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99 };

  return {
    unlock() { ac(); },
    toggleMute() { muted = !muted; return muted; },
    get muted() { return muted; },
    jump() { slide(420, 720, 0.13, 'square', 0.045); },
    land() { slide(180, 90, 0.08, 'sine', 0.05); },
    hurt() { slide(330, 90, 0.32, 'sawtooth', 0.07); },
    coin() { tone(N.E5, 0.09, 'triangle', 0.06); tone(N.G5, 0.12, 'triangle', 0.06, 0.08); },
    checkpoint() { tone(N.C5, 0.1, 'triangle', 0.06); tone(N.E5, 0.1, 'triangle', 0.06, 0.09); tone(N.G5, 0.18, 'triangle', 0.06, 0.18); },
    fail() { tone(N.G4, 0.16, 'square', 0.06); tone(N.E4, 0.16, 'square', 0.06, 0.15); tone(N.C4, 0.4, 'square', 0.06, 0.3); },
    levelClear() { [N.C5, N.E5, N.G5, N.C5 * 2].forEach((f, i) => tone(f, 0.2, 'triangle', 0.06, i * 0.11)); },
    /* "Happy Birthday", first phrase and a half — the win jingle. */
    birthday() {
      const q = 0.26;
      const song = [
        [N.G4, 0.5], [N.G4, 0.5], [N.A4, 1], [N.G4, 1], [N.C5, 1], [N.Bb4, 2],
        [N.G4, 0.5], [N.G4, 0.5], [N.A4, 1], [N.G4, 1], [N.D5, 1], [N.C5, 2],
      ];
      let t = 0;
      for (const [f, beats] of song) {
        tone(f, beats * q * 0.88, 'triangle', 0.07, t);
        t += beats * q;
      }
    },
  };
})();
