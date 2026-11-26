// Built-in demo tracks. Generated in code (no audio files, no licensing questions).
import { SR } from './engine.js';

function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

const SCALES = {
  minor: [0, 2, 3, 5, 7, 8, 10],
  major: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10]
};

// Makes a ~seconds-long melody + bass + hat track from a seed.
export function makeTrack(seed, seconds = 40, scaleName = 'minor', bpm = 110, root = 220) {
  const r = rng(seed);
  const n = Math.floor(seconds * SR);
  const out = new Float32Array(n);
  const scale = SCALES[scaleName];
  const beat = 60 / bpm;
  const note = (deg, oct = 0) => root * Math.pow(2, (scale[((deg % 7) + 7) % 7] + 12 * (Math.floor(deg / 7) + oct)) / 12);
  const addTone = (f, t0, dur, amp, harm) => {
    const s0 = Math.floor(t0 * SR), s1 = Math.min(n, Math.floor((t0 + dur) * SR));
    for (let i = s0; i < s1; i++) {
      const t = (i - s0) / SR;
      const env = Math.min(1, t / 0.01) * Math.exp(-t * (3 / dur));
      let v = 0;
      for (let h = 1; h <= harm; h++) { if (f * h < 3800) v += Math.sin(2 * Math.PI * f * h * t) / (h * h * 0.6 + 0.4 * h); }
      out[i] += amp * env * v;
    }
  };
  // random phrase of 8 notes that repeats with small changes
  let phrase = Array.from({ length: 8 }, () => Math.floor(r() * 8));
  let deg = 2;
  for (let bar = 0; bar * 4 * beat < seconds; bar++) {
    phrase = phrase.map((d) => (r() < 0.6 ? Math.floor(r() * 8) : d));
    for (let k = 0; k < 8; k++) {
      const t0 = bar * 4 * beat + k * beat * 0.5;
      const len = r() < 0.3 ? beat : beat * 0.5;
      addTone(note(phrase[k] + 7), t0, len, 0.30, 5);
    }
    deg = [0, 5, 3, 4][bar % 4] + (r() < 0.2 ? 1 : 0);
    addTone(note(deg - 7), bar * 4 * beat, beat * 2, 0.35, 3);
    addTone(note(deg - 7), bar * 4 * beat + beat * 2, beat * 2, 0.35, 3);
    // noise hat on offbeats
    for (let k = 0; k < 8; k++) {
      const s0 = Math.floor((bar * 4 * beat + k * beat * 0.5) * SR);
      for (let i = 0; i < 400 && s0 + i < n; i++) out[s0 + i] += (r() - 0.5) * 0.15 * Math.exp(-i / 90) * (k % 2 ? 1 : 0.5);
    }
  }
  let m = 0; for (let i = 0; i < n; i++) m = Math.max(m, Math.abs(out[i]));
  for (let i = 0; i < n; i++) out[i] /= m * 1.05;
  return out;
}

export const DEMOS = [
  { name: 'Demo: Neon Drift', seed: 11, scale: 'minor', bpm: 118, root: 196 },
  { name: 'Demo: Sunday Loop', seed: 4242, scale: 'major', bpm: 96, root: 247 },
  { name: 'Demo: Night Bus', seed: 777, scale: 'dorian', bpm: 132, root: 165 }
];
export function makeDemo(d) { return makeTrack(d.seed, 40, d.scale, d.bpm, d.root); }
